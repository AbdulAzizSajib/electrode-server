## Context

See proposal.md — Why.

Five properties of the existing system shape this design.

**`add-steadfast-courier-integration` deliberately deferred this.** Its Non-Goals said: "A carrier abstraction. This module is named for Steadfast and shaped by its API. A second courier is a second module and a decision made then, not a set of interfaces guessed at now." That was the right call, and this change is that decision being made — with a working integration to derive the interface from rather than guess at.

**The existing client is already the right shape.** [steadfast.client.ts](../../../src/app/module/courier/steadfast.client.ts) returns a discriminated `CourierResult<T>` of `ok` / `failed` / `unconfirmed`, never throws, and keeps its parsing quirks behind that boundary. The `unconfirmed` case in particular is not a Steadfast detail — it is what any HTTP courier call means when it times out. This is the interface; it just needs naming.

**`courier.service.ts` holds the parts that must not become per-provider.** Batch-then-persist, `matchResultsByInvoice`, dedupe-before-anything, the single `applyCourierStatus` both status paths converge on. Every one of these exists because getting it wrong duplicates a consignment or corrupts a status, and none of them is Steadfast-specific. A provider that could override them would reintroduce exactly the failures that module was written to prevent.

**Settings are a singleton row edited by disjoint partial PATCHes.** `StoreSetting` has a fixed id, `PATCH /settings` is a partial upsert, and roughly six admin editors coexist on it only because each sends a disjoint key set. A seventh editor is a well-trodden path here — but `GET /settings` is public, which constrains what may go on that row.

**Shipments already carry courier state.** `consignmentId`, `courierInvoice`, `courierStatus`, `courierSyncedAt`, plus `CourierTrackingEvent` history. What they do not carry is *who* issued the consignment, because until now there was only one possible answer.

## Goals / Non-Goals

**Goals:**
- Adding a courier is one adapter file and one registry entry, with no edit to `courier.service.ts`.
- A parcel in flight keeps settling against the courier actually carrying it, whatever the merchant later selects.
- The panel never offers an action the configured courier cannot perform.
- Existing installations behave identically after deploy, with no configuration step.

**Non-Goals:**
- A Pathao or RedX adapter. See proposal.md — this change makes one cheap to add and does not add one.
- Moving credentials out of the environment. Discussed and deferred; the env-vs-`StoreSetting` reasoning in Decision 1 of the Steadfast design still holds and nothing here weakens it.
- Per-order or rule-based courier choice ("parcels over 5kg go to X"). One shop, one courier, selected by a human.
- Migrating existing consignments between providers. There is no such operation at any courier.

## Decisions

### 1. The interface is extracted from the working client, not designed ahead of a second one

`ICourierProvider` is `steadfast.client.ts`'s existing surface with the names generalised: a bulk dispatch returning per-consignment outcomes keyed by invoice, a status lookup by consignment id, an optional balance read, an optional return request. `CourierResult<T>` moves to the interface unchanged.

Deriving it from one working implementation risks the interface being Steadfast-shaped. Designing it from two imagined couriers risks it being shaped by neither. The first failure is visible and fixable when the second adapter is written; the second is invisible until both are wrong. The `unconfirmed` outcome is the load-bearing part and it generalises cleanly — it describes a property of HTTP, not of Steadfast.

*Alternative considered:* wait for a real second courier before abstracting. Rejected — the merchant-facing need (choose your courier) exists now, and `MANUAL` satisfies it without a second HTTP adapter.

### 2. Providers translate; they do not orchestrate

The adapter owns what differs per courier: HTTP shape, auth headers, field limits, phone format, address composition, its own status vocabulary and how that maps to `ShipmentStatus`. `courier.service.ts` keeps everything else — dedupe, eligibility ordering, 50-per-batch with persist-between-batches, invoice matching, `applyCourierStatus`, audit logging.

The split is: **a provider decides what a courier is told and what its answer means; the service decides what we do about it.** Those failure modes are why the service exists, and a provider free to override them would be free to reintroduce them.

Concretely this means `courier.mapper.ts` and `courier.status.ts` become per-provider (their contents are Steadfast's limits and Steadfast's eleven statuses), while `matchResultsByInvoice` and the batching loop stay in the service.

*Alternative considered:* let each provider own its whole dispatch loop, so a courier with a genuinely different model could be supported. Rejected — it makes the duplicate-consignment guarantees per-provider, and they are the whole point.

### 3. `Shipment.courierProvider` — routing follows the consignment, not the setting

Every consignment records which provider created it. Reconciliation, webhook matching and return requests all route on that stored value; only *dispatch* reads the setting.

Without this, changing the setting silently breaks every parcel in transit: reconciliation would poll the new courier's API, with the new courier's credentials, for a consignment id it never issued. It would not error usefully — it would 404 per consignment forever, and the orders would sit in `SHIPPED` with nobody able to say why.

Existing rows backfill to `STEADFAST`, which is what they are.

### 4. Switching providers is blocked while consignments are in flight

Decision 3 makes a mid-flight switch *survivable* — old consignments still poll correctly. This decision makes it *clean*: the setting refuses while any non-terminal consignment exists under the current provider, naming the count.

The two are not redundant. Decision 3 is the safety net for a switch that happens anyway (a database edit, a restore, a bug); Decision 4 is the front door refusing to create the situation. A merchant switching couriers realistically does so between batches, so the constraint costs them a wait for parcels already out — which is also when the switch is actually safe, since their old courier account is still funded and their new one may not be configured.

The refusal names the count rather than saying "not allowed", because "23 parcels are still in transit" tells the merchant when to try again.

*Alternative considered:* allow the switch with a warning. Rejected — the failure it invites is silent and delayed, which is the worst combination available.

### 5. Webhooks get a per-provider path, with the old one aliased

`POST /courier/webhook/:provider`, each authenticating that provider's own token.

One shared endpoint would have to identify the sender before authenticating it — meaning it tries every configured token in turn, so a token leaked for one courier grants access to notifications for all of them. It would also have to sniff the payload shape to decide how to parse it.

`POST /courier/webhook` is kept, routing to Steadfast. A URL already registered in Steadfast's portal keeps working, which matters because re-registering is a manual step in someone else's UI and a webhook posted to a 404 is dropped with no record it was sent.

A webhook whose consignment belongs to a *different* provider is rejected rather than applied — see Decision 3; matching on consignment id alone would let two couriers' id spaces collide.

### 6. `MANUAL` is a provider, not the absence of one

A provider supporting nothing, registered like any other. Selecting it means "we use a courier this system does not integrate with" — dispatch is not offered, no configuration error is raised, and manual shipment entry works exactly as it does for any shipment without a consignment.

Modelling it as `courierProvider = null` instead would force every call site to answer "what if none is configured", and would make "deliberately unintegrated" indistinguishable from "misconfigured deployment" — which is precisely the distinction the merchant needs the panel to show.

This is also what makes the change useful to a non-Steadfast merchant *today*, without a Pathao adapter.

### 7. Capabilities are declared per provider and gate both UI and API

Each provider declares `{ dispatch, status, balance, returns, webhook }`. The admin hides undeclared actions; the API refuses them, naming the provider.

Both, not either. Hiding alone leaves an endpoint that fails confusingly when called directly; refusing alone leaves buttons that exist to fail. This mirrors the shipment-ownership guard already in `shipment.service.ts` — a control that visibly refuses beats one that silently does nothing.

### 8. The selection goes on `StoreSetting`; the credentials stay in the environment

`courierProvider` is an enum naming a courier. Leaking it grants nothing, so the public `GET /settings` payload carrying it is harmless. Credentials remain in the environment for the reason Decision 1 of the Steadfast design gives, unchanged.

The admin's courier settings editor follows the established `useSettingsDraft` + `useUnsavedChangesGuard` pattern and sends `{ courierProvider }` — a disjoint key set, so it cannot clobber another editor's fields.

It additionally *reads* per-provider configuration status (credentials present? webhook configured?) from a courier endpoint, not from settings — that is derived state about the environment, not a stored setting, and it must never round-trip through a writable row.

## Risks / Trade-offs

**The interface turns out to be Steadfast-shaped when a second adapter is written** → Likely in some detail, and cheap to fix at that point: one adapter, one interface, one service, all in-repo, with no external contract depending on the shape. The alternative — designing against couriers nobody has integrated — gets it wrong in ways nobody notices.

**Pathao does not fit the interface** → Its OAuth token refresh sits inside the adapter, which is where per-courier auth belongs. Its `city_id`/`zone_id`/`area_id` requirement is the real problem: it needs address resolution rather than a composed string, so its adapter's mapping step must be able to fail with "this address cannot be resolved to a Pathao zone". The interface already supports that — mapping failures are per-order refusals with a provider-specific reason (`api/courier`: order data maps on fixed rules). What it will additionally need is a place to *cache* the zone lookup, which is a schema decision for that change, not this one.

**A merchant switches provider and cannot switch back while the new courier's parcels fly** → Correct behaviour, but it means an ill-considered switch has a settling period. Mitigated by the refusal naming the in-flight count before the switch, so the cost is visible in advance rather than discovered after.

**Existing deployments break on deploy** → They cannot: `courierProvider` defaults to `STEADFAST`, `Shipment.courierProvider` backfills to `STEADFAST`, the old webhook path is aliased, and every environment variable keeps its name. A deployment that changes no configuration behaves identically.

**Two providers issue colliding consignment ids** → `Shipment.consignmentId` is currently globally unique, which stops being safe once two couriers issue ids from their own spaces. The uniqueness constraint becomes composite on `(courierProvider, consignmentId)`, and webhook lookup matches on both. With one provider registered this is a no-op; with two it is the difference between correct routing and applying one courier's status to another's parcel.

**Provider capability declarations drift from what the adapter actually does** → A declaration is a claim the code can contradict. Mitigated by verification scripts asserting that a provider declaring an action exposes a callable method for it, and that one not declaring it is refused at the service boundary.

## Migration Plan

1. Additive migration: `CourierProvider` enum; `StoreSetting.courierProvider` defaulting to `STEADFAST`; `Shipment.courierProvider` defaulting to `STEADFAST`. The `consignmentId` unique constraint becomes composite on `(courierProvider, consignmentId)`. Existing rows are correct under the defaults with no backfill script — every existing consignment is a Steadfast consignment.
   - Per the repo convention, strip the `DROP INDEX` lines Prisma emits for the three `pg_trgm` trigram indexes and carry forward the NOTE block.
2. Extract `ICourierProvider` and adapt the existing client behind it. This step changes no behaviour and is verifiable on its own: the existing courier verification scripts must pass unchanged.
3. Register `MANUAL`. Add the capability gate to the service.
4. Add the per-provider webhook route, keeping the existing path as a Steadfast alias.
5. Route reconciliation, webhooks and returns on the stored `Shipment.courierProvider`.
6. Admin: courier settings editor, then provider-aware naming and capability gating on the orders list, order detail and courier pages.
7. Update the Postman collection and run `verify:postman`.

**Rollback:** revert the code. The columns stay — dropping `Shipment.courierProvider` would discard which courier holds each in-flight parcel, and with one provider registered the column is inert anyway. The default keeps a reverted deployment working.

## Open Questions

Answerable during implementation without changing the specs, the approach or the task breakdown:

- Whether the courier-configuration status read (credentials present, webhook configured) belongs on the existing `GET /courier/balance`-adjacent surface or its own `GET /courier/config` endpoint. Both satisfy the spec; the second is likely cleaner since balance is a live courier call and this is not.
- Whether `courier.status.ts`'s `toShipmentStatus` should move wholesale into the Steadfast adapter or stay shared with per-provider vocabulary tables. The eleven statuses are Steadfast's, but the `ShipmentStatus` targets are ours, and which side of the boundary the mapping table sits on is a readability question rather than a correctness one.
- Whether the in-flight check for a provider switch should count consignments whose status is `unknown` (the courier telling us to contact support) as in-flight. Treating them as in-flight is the conservative default and is what the specs' "not in a terminal state" wording implies.
