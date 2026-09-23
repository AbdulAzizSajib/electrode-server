## Context

See proposal.md — Why. The design-relevant facts about the code as it stands:

- **Credentials are compiled into the process.** `steadfast.client.ts` reads `envVars.STEADFAST_API_KEY`
  at call time from a module-level singleton, and `SteadfastProvider` exposes `isConfigured()`,
  `isWebhookConfigured()` and `webhookToken()` as **synchronous** functions over `envVars`. Every caller
  — `courier.service.ts`'s `assertConfigured`, the `/courier/config` endpoint, `courier.guard.ts` —
  depends on that being synchronous.
- **`StoreSetting` is explicitly forbidden from holding secrets.** The `courierProvider` field's `///`
  comment states the rule and the reason: `GET /settings/public` serves this row, so "a secret on it is
  one careless field selection away from being published". That prohibition is not being repealed here;
  it is the constraint the storage design has to satisfy.
- **The provider/service split is load-bearing.** `courier.provider.ts` states at length that providers
  translate and the service orchestrates, and that a provider must not be able to override dedupe,
  batching, `matchResultsByInvoice`, or `applyCourierStatus`. Changing where credentials come from must
  not erode this: the contract claims `courier.service.ts` does not change when a courier is added, and a
  credential change that quietly rewrote the orchestration would make that claim false for the next one.
- **Webhook auth is already per-provider.** `courier.guard.ts` resolves the expected token *through the
  provider* rather than from one shared secret, precisely so one courier's leaked token cannot open
  another's endpoint. That shape survives; only the lookup's source and synchronicity change.
- **A pixel component already exists**, `nextjs/src/components/landing/FacebookPixel.tsx`, with a
  documented injection posture (id validated `^\d{5,20}$`, interpolated through `JSON.stringify`). The
  shop-wide pixel reuses it rather than writing a second bootstrap.
- **`PATCH /settings` is a partial upsert shared by seven editors** that coexist only by sending
  disjoint key sets.

## Goals / Non-Goals

**Goals:**

- Make "Integrations" a true name: a merchant can connect a courier and a pixel from the panel, without
  a developer, a `.env` edit, or a redeploy.
- Keep the public settings endpoint incapable of leaking a secret — structurally, not by remembering to
  omit a field.
- Upgrade a live shop without a dispatch outage and without the merchant re-entering credentials.
- Leave the courier adapter contract in a state where the next courier is genuinely one adapter file plus
  one registry entry.

**Non-Goals:**

- **A second courier.** Pathao is the obvious next one and is deliberately deferred: an adapter written
  against documentation, with no account to run it against, cannot be verified, and an unverifiable
  courier adapter is worse than none — it fails at dispatch, on real parcels. What this change owes it is
  a contract it can slot into, which Decision 3 delivers.
- **Per-tenant or multi-shop credentials.** One deployment serves one shop, so the table is keyed by
  provider, not by shop. Each merchant gets their own deployment and their own database, which is what
  makes a provider-keyed table sufficient. If that ever changes, the table gains a shop key and the
  resolution path changes with it — noted so the assumption is explicit rather than discovered.
- **A generic "integration plugin" abstraction.** Three integrations do not justify inventing a plugin
  host; couriers already have an adapter contract, and the pixel is a pair of config fields. What is
  shared between them is credential storage and the card layout, and only those are generalised.
- **Removing the Steadfast env vars in this change.** They are demoted to a read-only import source and
  deleted in a follow-up, once every environment is confirmed migrated.
- **Key rotation tooling.** Re-encrypting under a new key is out of scope; the key is set once. Noted in
  Risks.
- **CAPI event coverage beyond `Purchase`.** No `ViewContent`, `AddToCart`, or custom-event authoring —
  the same reasoning the landing pixel already records for refusing custom events.

## Decisions

### Decision 1 — Credentials live in their own table, not on `StoreSetting`

Two models, not one:

- **`Integration`** — one row per integration, keyed by `provider`. Holds `enabled` and the `publicId`
  the webhook URL carries.
- **`IntegrationCredential`** — one row per secret, unique on `(provider, kind)`, holding the encrypted
  `value` and a `lastFour` hint, cascading from `Integration`.

*Why two rather than one table with `enabled` on each credential row?* Because "is Steadfast enabled?"
must have exactly one answer, and Steadfast holds two credential rows (`apiKey`, `secretKey`). Putting
the flag on the credential row means two rows that can disagree, and nothing in the schema to say which
one wins — the `integrations` spec requires a disabled integration to be used by *no* server-side
operation, which is not a property a per-row flag can express. `publicId` has the same problem for the
same reason: it identifies the integration in `/api/v1/webhooks/<provider>/<publicId>`, so a per-kind
`publicId` would make the webhook URL ambiguous about which row minted it.

The split also states the lifecycle plainly: an integration exists and can be enabled before it has any
credentials (which is exactly the state the admin renders as "not configured"), and MANUAL exists with
no credentials at all.

*Why not `StoreSetting`?* Because the schema comment forbidding it is right, and the reason is
structural: `getPublicStoreSetting` uses `findUnique` with an `include`, not a whitelist `select`, so
every column on that row is one careless edit from being public. A separate table cannot be leaked by a
careless edit to a different query — an endpoint that never joins to it cannot serve it. That is a
stronger guarantee than "remember to exclude these fields", and it is the same reasoning that put the
keys in the environment in the first place. Storage moves; the prohibition does not.

*Why `kind` rather than a column per credential?* Steadfast needs two values, Pathao needs four, CAPI
needs one; a wide table would be mostly null and would need a migration per integration added. A
`(provider, kind)` row set is the shape that lets a new integration be a registry entry. The cost is
that the schema does not enforce which kinds a provider needs — that lives in the provider's declared
credential descriptor and in Zod, which is the same place the rest of this codebase enforces Json shape.

*Rejected:* a secrets manager (Vercel/AWS). Correct at scale, but it makes the credential a deploy-time
artifact again, which is exactly the problem being solved — the merchant must be able to change it from
the panel.

### Decision 2 — AES-256-GCM under one `INTEGRATION_ENCRYPTION_KEY`, required at boot

Node's built-in `crypto`, a 32-byte key from a required env var, random 12-byte IV per value, stored as
`v1:<iv>:<tag>:<ciphertext>` base64. No new dependency.

*Why required rather than optional-with-plaintext-fallback?* An optional key means a deployment that
forgot it silently stores plaintext secrets and nobody finds out. `env.ts` already throws at import time
for missing required vars, and this joins that list. Loud failure at boot beats quiet plaintext.

*Why the `v1:` prefix?* So a future algorithm change can be detected per value rather than needing a
flag day. Decrypt dispatches on it and rejects an unknown prefix.

*Why GCM over CBC?* Authenticated: a tampered ciphertext fails to decrypt rather than yielding garbage
that gets sent to a courier as an API key.

**Decrypt failure is treated as "not configured", not as a crash.** A wrong key must degrade to a
courier that refuses to dispatch with a clear message, not a 500 on every admin page load. It is logged
once (following `courier.guard.ts`'s existing `warnOnce`).

### Decision 3 — The provider credential contract becomes async, and credentials are passed in

`ICourierProvider` changes shape:

```
isConfigured(): boolean            →  isConfigured(): Promise<boolean>
isWebhookConfigured(): boolean     →  isWebhookConfigured(): Promise<boolean>
webhookToken(): string | undefined →  webhookToken(): Promise<string | undefined>
createConsignments(requests)       →  createConsignments(requests, creds)
getStatus(id)                      →  getStatus(id, creds)
getBalance()                       →  getBalance(creds)
createReturnRequest(id, reason)    →  createReturnRequest(id, reason, creds)
```

*Why pass credentials in rather than let each adapter fetch its own?* Two reasons. One dispatch run
resolves credentials **once** and threads them through every batch, so a 200-order dispatch does not do
200 decrypt round-trips and cannot observe a credential changing halfway through a run — the batching
loop persists results between batches, and a credential swapping mid-loop would mean two batches of one
dispatch going to two different accounts. Two, it keeps the adapters pure-ish and directly testable: a
verify script constructs credentials and calls the adapter, with no database in the way, which is how
the existing `verify-courier-provider.ts` works.

*Why async `isConfigured` rather than a cached synchronous view?* A cache would make "I changed the key
and it still says unconfigured" a real support burden, and the spec requires a credential change to take
effect without a restart. The reads are per-request on admin pages and once per dispatch run, so the
cost is not on any hot path.

`mapOrder` and `readStatus` stay synchronous and credential-free — they are pure, and the service calls
`mapOrder` twice (preview and dispatch) precisely because it is cheap.

### Decision 4 — The credential descriptor is declared per provider, so the admin form is generated

A provider declares what it needs: `[{ kind: "apiKey", label: "API Key", secret: true }, …]`. The admin
renders the credential form from that declaration rather than hardcoding Steadfast's two fields.

*Why bother, with only one courier that has credentials?* Because the alternative is a Steadfast-shaped
form that the next courier has to rewrite, and the next courier does not have the same fields — Pathao
needs four, including an OAuth client id and a password. The declaration is a few lines and it is what
makes the deferred second courier an adapter file rather than an adapter file plus an admin rewrite. This
is the same reasoning `courier.provider.ts` already applies to capabilities, which are declared and
enforced on both sides rather than inferred.

It also means the admin never hardcodes which fields are secret — `secret: true` drives the masked input
and the write-only treatment together, so a new credential cannot accidentally be rendered in plain text.

*Rejected:* a per-provider React component per credential form. More expressive, but it puts the
"which of these is a secret" decision in two places, and those two places drift.

### Decision 5 — A new `/integrations` module, not `PATCH /settings`

`GET /integrations`, `PUT /integrations/:provider/credentials`, `PUT /integrations/:provider/webhook`,
`PATCH /integrations/:provider` (enable/disable), under `checkAuth(OWNER, ADMIN)`.

*Why not extend `PATCH /settings`?* Three reasons, any one sufficient: that endpoint's partial-upsert
contract is shared by seven editors and is already delicate; its GET counterpart's public sibling is the
thing we are keeping secrets away from; and write-only fields do not fit an endpoint whose read returns
what its write accepted.

**Secrets are write-only.** `GET /integrations` returns `{ provider, displayName, enabled, capabilities,
credentials: { <kind>: { present: boolean, hint: "••••1234" } }, webhook: { configured, callbackUrl } }`.
There is no endpoint that returns a stored value — not masked-on-the-client, not "reveal" — because a
value the API can return is a value an XSS or a logged response can capture.

**A submitted credential is never echoed back**, including in validation errors, which is the one place
a naive Zod error handler would leak it.

### Decision 6 — Webhook secrets are generated server-side, and the callback URL carries an unguessable id

The merchant presses Generate; the server produces 32 random bytes. The callback URL becomes
`/api/v1/webhooks/<provider>/<publicId>`.

*Why generate rather than accept?* A merchant-chosen webhook secret is a merchant-chosen password, with
the failure mode that implies. The screenshots already show "Auto Generated", which is the right call.

*Why a `publicId` in the path at all, given the bearer token?* Defence in depth and operability: the path
is not enumerable, and it identifies which shop and provider a notification is for before any
authentication work happens. It is an identifier, not a secret — the bearer token remains the boundary.

**The existing `/courier/webhook/:provider` route keeps working**, authenticating against the same stored
secret. A shop that already pasted the old URL into Steadfast's panel must not silently stop receiving
statuses because we improved the URL — that failure is invisible until parcels appear stuck.

Regeneration invalidates immediately and the UI says so, because the window between regenerating here
and pasting there is a window of dropped notifications.

### Decision 7 — Pixel id is public config; CAPI token is a secret. They are stored differently.

`StoreSetting.integrationConfig` Json holds `{ facebookPixel: { enabled, pixelId }, facebookCapi: {
enabled, testMode, testEventCode } }` and is served by `GET /settings/public`. The CAPI **access token**
goes in `IntegrationCredential`.

This split looks inconsistent and is deliberate: a pixel id is published to every visitor by the very act
of using it, so hiding it costs a round trip and buys nothing; an access token can post events as the
merchant's business. Storing them together would mean either putting a secret on the public row or making
the storefront fetch its pixel id through an authenticated endpoint. The rule is *what the browser sees
anyway goes in public config; what it must never see goes in the credential table.*

`testEventCode` is public config despite the screenshot's masked input — it is a Meta debug-panel code,
not a credential, and it must be readable by whoever is debugging.

Json columns are unconstrained by Postgres, so per the existing convention the Zod schema is the only
gate, and `integrationConfig` is validated as a whole.

### Decision 8 — Shop-wide pixel renders in `(shop)`; landing pixel wins on `(landing)`

The `(shop)` layout renders `FacebookPixel` when configured. `(landing)` is deliberately bare and
continues to render only its own page's pixel — and when a landing page has no pixel of its own, it falls
back to the shop-wide one.

*Why does precedence matter?* The two route groups do not nest, so there is no path where both layouts
run; the real risk is a merchant setting the same id in both places and reading double conversions.
Precedence is resolved where the pixel id is chosen, not by suppressing an event after the fact.

`Purchase` fires from the confirmation, reusing `trackLandingPagePurchase`'s existing posture: a no-op
when no id, a no-op when `fbq` is absent, wrapped in try/catch. Measurement never breaks a confirmation.

### Decision 9 — CAPI is fire-and-forget, modelled on `revalidateStorefront`

Order creation calls the CAPI dispatcher **without awaiting it**, and the dispatcher never throws —
exactly the shape `utils/revalidateStorefront.ts` already establishes for a non-critical outbound call
that must never fail a mutation.

*Why not a job queue?* There isn't one, and introducing one for best-effort analytics is
disproportionate. The trade-off — a serverless function may be frozen before the request completes, so a
small fraction of events are lost — is stated in Risks and is acceptable for measurement. It would not be
acceptable for the order itself, which is why the order is written first and committed independently.

Customer email/phone are hashed (SHA-256, normalised) before sending, per Meta's requirement; raw PII is
never sent.

### Decision 10 — The shared event id is the order's own id, not a generated UUID

Both the browser `Purchase` and the server-side `Purchase` send `event_id = <the order's id>`. Meta
collapses two events with the same `event_id` and `event_name` into one conversion.

*Why the order id rather than a UUID minted at checkout?* A UUID generated in the browser has to survive
the checkout POST, be stored on the order, and be read back on the confirmation — three places it can be
lost, and if it is lost the two paths silently diverge into double-counting, which is the exact failure
being prevented. The order id is already generated by the server, already returned to the confirmation,
already stored, and already unique. It satisfies every property the spec asks for — stable per order,
never reused — without a new column, a new checkout field, or a new way to fail.

*Why does this matter enough to be in scope at all?* Because the two paths are additive. A merchant who
turns on CAPI without deduplication sees conversions roughly double overnight, concludes the campaign is
working, and raises the budget against revenue that does not exist. Shipping CAPI without this would make
the feature actively harmful, which is why it moved out of Non-Goals.

*One caveat kept honest:* the confirmation can be reloaded, and the browser pixel will fire again. It
fires with the same `event_id`, so Meta still counts one conversion — which is precisely why the id must
be derived from the order rather than from the page load.

*Rejected:* suppressing the browser event whenever CAPI is enabled. Simpler, but it throws away the
browser signal Meta uses for attribution and audience matching, which is half of why the pixel exists.
Meta's own guidance is to send both and deduplicate.

### Decision 11 — The admin page is one card component per integration, sharing a card shell

`src/features/ui/integrations/` with `integrations-page.tsx` and one component per integration. **Not**
`useSettingsDraft` + one `EditorActions` bar: that pattern exists for *one* settings block with one Save,
and the screenshots show per-card Save buttons. Per-card save is also what the spec requires — saving the
pixel must not touch courier fields — and it falls out naturally when each card owns its own mutation.

Courier *selection* keeps its existing radio + in-flight refusal behaviour, moved into the courier card
rather than rewritten.

`/ui/courier-settings` becomes a redirect route rather than being deleted, and per the standing
two-places rule, `nav-config.ts` and `app-router.tsx` are both updated.

## Risks / Trade-offs

- **Losing `INTEGRATION_ENCRYPTION_KEY` makes every credential unrecoverable** → Documented as a
  deploy prerequisite; the failure is loud (boot refusal) rather than silent; re-entry through the panel
  is a bounded recovery path (minutes, not a data-loss event). No rotation tooling, so the key is set
  once — accepted, and a follow-up if a rotation need appears.
- **The async provider contract touches every courier call site at once** → The signature change is
  mechanical and TypeScript finds all of it; the behavioural risk sits in `courier.guard.ts`, where the
  token lookup moves from sync to async inside Express middleware. Guarded by the existing
  `verify-courier-webhook-routing.ts`, extended to cover a DB-sourced token and a decrypt failure.
- **A half-migrated environment dispatches with the wrong account** → The import runs once, only fills
  rows that are absent, and never overwrites a merchant-entered value. Env is a fallback *only* when no
  row exists, so a merchant who has entered credentials can never be silently reverted to the env ones.
- **Regenerating a webhook secret drops notifications until the courier's panel is updated** → Warned in
  the UI at the moment of regeneration; the scheduled reconciliation sync still catches up the statuses
  missed, which is precisely the safety net it exists for.
- **Serverless freeze loses some fire-and-forget CAPI events** → Accepted for measurement; the same
  trade-off `revalidateStorefront` already makes. Worth stating plainly: CAPI here improves coverage over
  the pixel alone, it does not guarantee delivery of every event.
- **Deduplication depends on Meta honouring `event_id`** → It is Meta's documented mechanism and the only
  one available; if it were to stop working the symptom is inflated conversion counts, visible in Events
  Manager, not a broken checkout. Verified in test mode before the merchant relies on the numbers.
- **The migration will contain `DROP INDEX` for the three trigram indexes** → The standing repo rule;
  called out as its own task with the NOTE block carried forward, because this is the failure that is
  invisible until product search is a sequential scan.

## Migration Plan

1. Set `INTEGRATION_ENCRYPTION_KEY` (32 bytes, base64) in every environment **before** deploying. The
   server refuses to boot without it, so a missed environment fails visibly at deploy rather than at the
   first dispatch.
2. Deploy schema migration: `Integration`, `IntegrationCredential` and `StoreSetting.integrationConfig`.
   **Delete the `DROP INDEX` lines from the generated SQL and carry forward the NOTE block.**
3. On boot, a one-time import ensures an `Integration` row per registered provider and writes any
   `STEADFAST_API_KEY` / `STEADFAST_SECRET_KEY` / `STEADFAST_WEBHOOK_TOKEN` present in the environment
   into `IntegrationCredential`, skipping any kind that already has a row. Idempotent; safe on every
   boot.
4. Deploy server, then admin, then storefront. Existing Steadfast dispatch continues throughout — the
   provider reads a row whose contents are byte-identical to what the env held.
5. Merchant optionally generates a new webhook secret and pastes the new callback URL. Not required: the
   imported token and the old URL keep working.

**Rollback:** revert the application deploy. The new table and column are additive and unread by the
previous version; the env vars still hold the Steadfast credentials, which the old code reads directly.
Anything a merchant entered through the new panel is not visible to the reverted code — so a rollback
after a merchant has changed credentials in the panel requires putting those values back in the
environment. That window is the one irreversible-ish step and is why the env vars are not deleted in
this change.

## Open Questions

- **Whether the shop-wide pixel should also fire `InitiateCheckout` and `AddToCart`.** Deferred:
  additive, no schema or contract implication, and better decided once a merchant is looking at real
  `PageView`/`Purchase` numbers and can say which gap actually hurts.
- **Whether the Steadfast env vars can be deleted immediately after the first deploy**, or should survive
  a release cycle as a rollback path. Decidable once every environment is confirmed migrated; it changes
  nothing in this change, which keeps them either way.
