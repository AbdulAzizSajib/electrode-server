## Context

See proposal.md — Why.

What shapes this design is that almost none of it is new. `rename-courier-setting-to-integrations` left
behind a registry where an integration declares its credentials and the admin renders the form from that
declaration; `Integration` keys on an arbitrary provider string and `IntegrationCredential` holds an
arbitrary set of kinds, encrypted under `INTEGRATION_ENCRYPTION_KEY`; `facebook-capi.ts` already
demonstrates the shape of a best-effort outbound call that must never fail the operation that triggered
it. Telegram needs no schema change and no new architectural idea — it needs a registry entry, a sender
modelled on the CAPI one, and four call sites.

Three constraints do the real work of deciding things:

1. **The four events already have notification call sites.** `order.service.ts`, `stock.service.ts` and
   `support-ticket.service.ts` each call `NotificationService` at the exact moment an alert is warranted.
   Nothing needs to be re-derived or re-detected.
2. **There is no job queue anywhere in this server.** Retry is not a thing that can be added cheaply; it
   is a subsystem. That forces the delivery posture rather than merely suggesting it.
3. **The chat id is typed by hand** (see proposal.md — What Changes). Everything about verification
   follows from there being no machine check that the merchant typed the right number.

## Goals / Non-Goals

**Goals:**

- A merchant connects Telegram from the admin panel with no developer, no `.env` edit and no redeploy —
  the same bar `rename-courier-setting-to-integrations` set for couriers.
- A configuration mistake is discovered on the configuration page, not weeks later through a missed
  order.
- The four dispatch points cost one line each and change no existing behaviour.
- The next notification channel (a second Telegram chat, WhatsApp, Discord) reuses this shape rather than
  motivating a rewrite.

**Non-Goals:**

- Guaranteed delivery. Explicitly out of scope; see Decision 6.
- Any inbound direction — the bot receives nothing, registers no webhook, answers no command.
- Per-recipient or per-role routing. One shop, one chat. Routing different events to different chats is a
  later change and nothing here forecloses it.
- Customer-facing Telegram messages. This is staff-facing only.

## Decisions

### Decision 1: Telegram is a registry entry, not a new subsystem

Telegram is added to `INTEGRATIONS` in `integration.constant.ts` with two credential descriptors. The
admin card, the masked input for the token, the enable toggle, the `configured` / `readable` states and
the OWNER/ADMIN gate all come from machinery that already exists.

*Alternatives considered:*

- **Environment variables** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). Rejected for the same reason the
  courier keys left the environment: under the agency model each client is a separate clone with a
  separate deployment, so an env var means a developer touches every new client before they can receive
  a single notification. The registry is what makes it self-serve.
- **A dedicated `NotificationChannel` model** with a type enum and per-channel config. Rejected as
  premature: it is the right model for three channels and the wrong one for the first, and
  `IntegrationCredential`'s `(provider, kind)` shape already expresses everything a second channel would
  need.

### Decision 2: A third category, `NOTIFICATION`

`IntegrationCategory` becomes `"COURIER" | "MARKETING" | "NOTIFICATION"`, and the admin grows a
corresponding section.

*Alternative considered:* file it under `MARKETING` and add no type. Rejected because the categories are
how the admin page groups its cards, and a merchant hunting for "where do I turn off the order alerts"
would be looking under Marketing next to the Facebook pixel — a grouping that is wrong about what the
integration is for. A one-word union member is a cheaper fix than a misleading page.

### Decision 3: The chat id is a non-secret credential, not `StoreSetting.integrationConfig`

`chatId` is stored in `IntegrationCredential` with `secret: false`, which means it is encrypted at rest
like every other row in that table but is returned in full by `GET /integrations`.

*Alternative considered:* put it on `StoreSetting.integrationConfig`, alongside the Facebook pixel id.
That is where the precedent for "configuration-shaped, not secret" lives, and it is the wrong home here:
`GET /settings/public` serves that row to every visitor of the storefront. The pixel id is published to
every visitor anyway by the act of rendering the pixel; a chat id is not secret but is nobody's business
outside the shop, and putting it one careless `select` away from the public endpoint gains nothing.

`secret: false` on a credential row gives exactly the property wanted — readable to an authenticated
OWNER/ADMIN, invisible to everyone else — and the descriptor's existing `secret` flag already drives it.

### Decision 4: Manual chat id entry, with an explicit test send instead of auto-detection

The server never calls `getUpdates`. The merchant pastes the chat id; a **Send test message** action
verifies it.

*Alternative considered and rejected: auto-detection via `getUpdates`.* It is the friendlier flow and it
has three failure modes that manual entry does not:

- `getUpdates` and a registered webhook are **mutually exclusive** — Telegram answers `409 Conflict` if
  the bot has a webhook set. This server already runs webhook infrastructure for Steadfast, and the
  conflict would be intermittent and baffling.
- Updates are retained for **24 hours**. A merchant who messages the bot on Sunday and opens the panel on
  Tuesday gets an empty result that is indistinguishable from doing it wrong.
- Bot **privacy mode is on by default in groups**, so a merchant typing `hi` in the group produces
  nothing; only `/start@thebot` reaches the bot. The detection flow would have to teach this anyway,
  which is most of the instruction text that manual entry needs regardless.

*Alternative considered and rejected: a link-code flow* — the panel shows a code, the merchant sends it
to the bot, an inbound webhook matches it. This is the best experience of the three and needs a public
inbound endpoint, a code store with expiry, and an authorization story for a route Telegram calls. That
is a larger change than the feature it would serve.

The cost of manual entry is real and singular: a typo produces silence. The test send converts that into
an error message on the page where the mistake was made, which is why it is not optional.

### Decision 5: Each event composes its own message — no bridge on `NotificationService`

The dispatch calls sit at the four event sites and each builds its own text. There is deliberately **no**
hook inside `NotificationService.notifyOwnersAndAdmins` that mirrors every staff notification to
Telegram.

This is the obvious shortcut and it is wrong for three separate reasons:

- **It would fan out everything.** `notifyOwnersAndAdmins` is also called by `purchase-order.service.ts`,
  and `createNotification` by payment, refund, return and review. A merchant who asked for order alerts
  would get their phone buzzing for a review. Subscribing to a shared write path means inheriting every
  future caller of it, sight unseen.
- **The in-app message text is the wrong text.** `"Order ORD-2451 was placed for 12450."` is correct for
  a row in a panel that links to the order. The Telegram message has to carry the phone number and the
  address, because its entire purpose is to remove the trip to the panel. They are different messages for
  different media and forcing one string to serve both degrades both.
- **It would couple two independent failure domains.** `NotificationService` writes rows in a path that
  sometimes runs inside an open transaction; an HTTP call must not be reachable from there.

The cost is four call sites instead of one, and a message builder per event. That is the correct amount
of duplication for four things that genuinely differ.

### Decision 6: Fire-and-forget, modelled on `facebook-capi.ts`

Each dispatch is `void`-called, not awaited, and swallows its own errors after logging. `fetch` carries
`AbortSignal.timeout(TIMEOUT_MS)` with the same 3000 ms budget `facebook-capi.ts` uses — the number is
matched deliberately so there is one answer in this module to "how long may an outbound integration
call block".

*Alternative considered:* an outbox table plus a worker, giving at-least-once delivery. Rejected because
there is no worker process in this server and introducing one for notification retry is a larger change
than the feature. It is also the right shape if retry is ever wanted, and nothing here prevents it: the
call sites would write a row instead of calling `fetch`.

The honest consequence is stated in the spec rather than hidden: a failed message is lost, and the in-app
notification is the durable record that makes that acceptable.

### Decision 7: `parse_mode: "HTML"`, and every interpolated value is escaped

Messages use HTML markup and escape `&`, `<` and `>` in every value taken from the database.

*Alternative considered:* `MarkdownV2`. Rejected on a concrete failure: it requires escaping
`_ * [ ] ( ) ~ \` > # + - = | { } . !` — eighteen characters, including `.` and `-`. A Bangladeshi phone
number and a hyphenated address both contain them. An unescaped one produces `400 Bad Request`, which in
a fire-and-forget path means the message silently never arrives, for exactly the orders whose data is
unusual. HTML's three characters can be escaped correctly in one small function that is hard to get
wrong.

Legacy `Markdown` is worse than both — it cannot express nesting and has its own escaping rules.

### Decision 8: The gate is credential presence, not `isEnabled`

`IntegrationService.isEnabled` returns `row?.enabled ?? true` — **it answers `true` for an integration
that has no row at all.** That default exists so the courier migration did not stop dispatching when
nothing had flipped a flag, and it is correct there. It means a shop that has never heard of Telegram
reports the Telegram integration as enabled.

So the dispatch guard is: resolve the credentials first, and return silently unless **both** `botToken`
and `chatId` came back. `isEnabled` is then checked as the merchant's explicit off switch. Reading them
in the other order would be a bug that only shows up as log noise on every shop that never configured
the feature — which is most of them, most of the time.

`resolveCredentials` already omits any kind that fails to decrypt, so an unreadable token is
indistinguishable from an absent one at the call site, which is the behaviour the spec asks for.

### Decision 9: The test endpoint is `POST /integrations/:provider/test`, dispatched by provider

The route follows the existing `/:provider/credentials` and `/:provider/webhook` shape rather than
hardcoding `TELEGRAM` in a path. The service holds a small map from provider id to a test function;
a provider with no entry is refused with 400.

*Alternative considered:* a `testable` flag on the descriptor. Rejected as a field that would exist to
describe one integration. The map is smaller, and when a second testable integration appears it is one
entry, at which point promoting it to the descriptor is a mechanical change.

Unlike every other dispatch in this change, this one **awaits** the result and reports the failure —
that is the entire point of it, and it is the only place in this capability where a caller sees a
delivery error.

## Risks / Trade-offs

- **Customer PII leaves the system to a third party.** Order messages carry name, phone and address to
  Telegram's servers. → Accepted, not mitigated away: the phone number is the feature. Mitigated by
  disclosure — the admin card states it, and the operating condition is a private, staff-only chat. A
  merchant who does not want it declines the integration, which is a real choice they can make on the
  page.
- **Staff who leave keep seeing orders** until removed from the group. → This is Telegram group
  administration, outside what the panel can enforce. Called out in the card's instructions.
- **A failed message is gone.** → In-app notification remains; the panel is the source of truth. Accepted
  in Decision 6.
- **Fire-and-forget may not complete on Vercel**, where the function can be frozen after the response.
  → Pre-existing: the current low-stock and staff notifications have the identical exposure today, so
  this change adds no new class of problem. Resolved by the move to a persistent Node process.
- **Outbound HTTPS to `api.telegram.org` may be blocked on shared cPanel hosting.** → Must be verified
  before the hosting migration. It is the same verification Facebook CAPI already needs, so it is one
  check covering two features, not a cost this change introduces.
- **Campaign spikes can exceed useful and eventually allowed message rates.** Telegram's default ceiling
  is 30 messages/second and flood control replies with `retry_after`; with no retry those are dropped.
  → Accepted at current volume. A digest is the named follow-up, and Decision 5's per-event composition
  is what makes it easy — a digest replaces one builder, not the dispatch architecture.
- **A leaked bot token lets someone post as the bot.** → Encrypted at rest, never returned by any
  endpoint, OWNER/ADMIN-only to write. Rotation is pasting a new token from @BotFather, which the
  existing upsert already handles.
- **A wrong chat id is silent.** → The test send exists for precisely this, and is the reason it is part
  of this change rather than a follow-up.

## Migration Plan

There is nothing to migrate. No schema change, no data change, no environment change — the feature is
inert until a merchant saves credentials, and every shop starts inert.

Deploy is additive: the new registry entry makes a card appear, the four dispatch points return silently
until configured.

Rollback has two levels. A misbehaving integration is switched off from the admin panel with no deploy,
which is the intended first response. A code rollback removes the registry entry and the dispatch calls;
the stored `Integration` row and its credentials are then unreferenced but harmless, and are read again
if the change is re-applied.

## Open Questions

- Whether order alerts should eventually route to a different chat than stock and support alerts. One
  chat is right for a shop where the same two people handle everything, and the answer changes with
  staff size, not with anything in this design. Per-event routing would be additional credential kinds
  and a message-builder argument; it does not alter the specs or the approach chosen here.
