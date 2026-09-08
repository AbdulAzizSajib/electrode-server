## Context

See proposal.md — Why.

Four properties of the existing system shape everything below.

**The server is a Vercel function.** [vercel.json](../../../vercel.json) rewrites every path into `api/index.js` with `maxDuration: 30`. There is no process that outlives a request, so `node-cron` — already a dependency, already commented out in `app.ts` — cannot drive a recurring job here. Thirty seconds is also the hard ceiling on how much work one dispatch request may do.

**Phone numbers are canonical E.164.** `utils/phone.ts` normalises every stored number to `+8801XXXXXXXXX` because guest checkout merges customers on phone. Steadfast accepts only the 11-digit local form, so conversion is mandatory rather than cosmetic.

**An address is six columns, not a line.** `CustomerAddress` holds `fullName`, `phone`, `addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, `country`. Steadfast wants one string of at most 250 characters. Landing-page orders additionally carry their delivery zone in `state`.

**Steadfast pushes status by webhook, and can also be polled.** The merchant's portal has a Webhook Integration form taking a callback URL and a bearer token we choose, and it sends two notification types: `delivery_status` (`consignment_id`, `invoice`, `cod_amount`, `status`, `delivery_charge`, `tracking_message`, `updated_at`) and `tracking_update` (`consignment_id`, `invoice`, `tracking_message`, `updated_at`). Both carry `invoice`, so the matching rule used everywhere else in this design holds for them too. The polling endpoints — `status_by_cid`, `status_by_invoice`, `status_by_trackingcode` — remain available.

This corrects an earlier reading of the published API document, which describes only the polling endpoints. The webhook is documented in the portal, not in that document.

Two details of the webhook payload matter. Its `status` vocabulary is **shorter** than the polling API's — `pending`, `delivered`, `partial_delivered`, `cancelled`, `unknown` against the polling endpoint's eleven — so the webhook is not a superset of what polling reports. And the portal's own example sends `"status": "Delivered"` while its field table lists lowercase values, so status comparison must be case-insensitive.

## Goals / Non-Goals

**Goals:**
- One dispatch action for a selection of packed orders, with a per-order outcome the operator can act on.
- No mechanism by which one parcel becomes two consignments.
- Delivery state visible in the admin panel without opening Steadfast's portal.
- A record that survives a request dying mid-batch.

**Non-Goals:**
- A carrier abstraction. This module is named for Steadfast and shaped by its API. A second courier is a second module and a decision made then, not a set of interfaces guessed at now.
- A job queue or worker. None exists in this system and introducing one for this is disproportionate.
- Reconciling consignments created outside this system in Steadfast's portal.

## Decisions

### 1. Credentials in the environment, not `StoreSetting`

Everything merchant-facing in this platform lives in store settings, and this deliberately does not. `GET /settings` is a public endpoint whose payload the storefront renders into every page; a secret stored in that row is one careless field selection away from being served to the internet. Cloudinary's credentials already sit in the environment for the same reason.

The cost is that rotating a key is a redeploy rather than a form. That is the correct trade for a credential which, if leaked, lets a stranger create consignments billed to the merchant.

*Alternative considered:* an encrypted column with an admin-only read path. Rejected — it adds key management to buy back a convenience the merchant needs roughly never.

### 2. `orderNumber` is the `invoice`

Steadfast requires `invoice` to be unique per consignment, and we need a value that ties a physical parcel, an admin record and a consignment together. `orderNumber` is already unique in the database, already immutable, and already what the barcode on the printed label encodes ([shipping-label.tsx](../../../../admin/src/features/sales/orders/documents/shipping-label.tsx) asserts that equality in `code128.test.ts`). A scanned parcel therefore yields the exact string Steadfast knows it by.

It is stored back on the shipment as `courierInvoice` rather than merely recomputed. Reconciliation after a failure must ask "what did we actually send", and a value derived at read time cannot answer that if the derivation ever changes.

*Alternative considered:* a generated dispatch reference. Rejected — a second identifier for the same parcel, with nothing printed on the box carrying it.

### 3. The courier's status is stored raw, beside the internal enum

Steadfast has eleven `delivery_status` values, several of them approval-pending intermediates. `ShipmentStatus` has eight, and they mean different things. Forcing one onto the other loses information the operator needs: `delivered_approval_pending` and `delivered` both become `DELIVERED` under any sane mapping, yet only the second means the merchant has been paid.

So `courierStatus` stores Steadfast's string verbatim and `status` keeps its own enum, derived from it. The derivation is deliberately conservative — only `delivered` sets `DELIVERED`, only `cancelled` sets `RETURNED`, and every approval-pending value maps to `IN_TRANSIT` — and the raw value is what the admin panel shows when the two would disagree.

### 4. Batch of 50, request capped at 200, persisted after every batch

Steadfast allows 500 per bulk call. We send 50. The binding constraint is not their limit but our 30-second function: a 500-item call plus its database writes will not finish, and a dispatch that dies after Steadfast has committed is exactly the failure this design exists to prevent.

**Each batch's results are written before the next batch is sent.** This is the single most important property here. A request killed at the ceiling then loses the *response*, not the *record* — the consignments already created are already stored, so the operator refreshes and sees precisely which orders went. Accumulating results and writing once at the end would turn a timeout into an unrecoverable divergence between our database and Steadfast's.

A selection larger than 200 is refused with a message telling the operator to split it, rather than accepted and silently truncated.

*Alternative considered:* accept any size and process asynchronously. Rejected — there is no queue, no worker, and no place to put job state; building all three is a larger change than this one.

### 5. Results matched by `invoice`, never by array position

The documented bulk response is an array of per-item objects each carrying its own `invoice`. Nothing in the documentation promises that array is ordered like the request, and a mis-ordered response applied positionally would write one order's consignment id onto another order — a wrong tracking number given to a customer, and a parcel nobody can find. Matching on `invoice` costs one map lookup.

An invoice in the response that matches no order in the batch is logged and skipped rather than guessed at.

### 6. A timeout reports "unconfirmed", not "failed"

Aborting our HTTP request does not abort Steadfast's handler. On a timeout the consignments may well exist and we simply do not know, so telling the operator it failed invites the retry that duplicates them.

The storefront already solved this exact problem: `proxyRequest` in [api-proxy.ts](../../../../frontend/src/lib/api-proxy.ts) distinguishes a timeout (504, `timedOut: true`, "your request may have gone through") from an unreachable server (503, safe to retry). This module takes the same posture, with one addition — the affected orders can be reconciled by querying `status_by_invoice` for each, since we know exactly which invoices were in flight.

### 7. The webhook is the primary path; scheduled polling is the reconciliation net

Status arrives two ways, and both are needed.

**`POST /api/v1/courier/webhook` is how status normally arrives.** Steadfast pushes it within moments of a change, so the panel is current without anyone waiting on a five-minute polling window. The endpoint authenticates the bearer token configured in the portal's Webhook Integration form — a token we generate and hold in `STEADFAST_WEBHOOK_TOKEN`, compared in constant time.

**`POST /api/v1/courier/sync` remains, as a net rather than the mechanism.** A webhook is a single delivery attempt against an endpoint that will occasionally be mid-deploy, rate-limited, or briefly unreachable, and Steadfast's documentation promises no retry. A webhook-only design has no way to notice it missed one: the order simply sits in `SHIPPED` forever and nobody learns why. So the scheduled job stays, and its query narrows to consignments that are **not terminal and have not been heard from recently** — it is looking for silence, not refreshing everything. That makes it cheap enough to run often and still meaningful.

Polling is also the only path that can see the eleven-value vocabulary; the webhook reports five. An approval-pending state therefore reaches us through reconciliation, not through the push.

`node-cron` cannot drive the schedule on this deployment — the server runs as a Vercel function and no process survives between requests — so the job is a secret-protected endpoint called by Vercel Cron. That secret follows the pattern `revalidateStorefront` already established for machine-to-machine calls here: a header the caller must present, an endpoint that refuses without it, and one clear log line when unconfigured rather than silent inaction.

Both paths converge on one function that applies a status to a shipment, so they cannot drift. Both are idempotent — applying the same status twice is a no-op — which is what makes a re-delivered webhook and a double-fired cron equally harmless. Sync processes a bounded number per run and leaves the rest for the next tick, staying inside the 30-second ceiling, and issues its queries sequentially: Steadfast documents no rate limit, and a fan-out against an undocumented limit is how one gets a limit imposed.

*Alternative considered:* webhook only, dropping the scheduled job. Rejected — it optimises away the only mechanism that can detect its own failure.

### 11. Tracking events are stored as history, not as a latest-value column

`tracking_update` notifications carry a human-readable line — "Package arrived at the sorting center" — and they arrive repeatedly over a parcel's life. Keeping only the most recent would answer "where is it now" while destroying "where has it been", which is the question customer service actually gets asked when a parcel is late.

So each notification is appended to a `CourierTrackingEvent` row. Both notification types are recorded, since a delivery-status change is a tracking event too and interleaving them is what makes the sequence readable.

**Webhook deliveries must be assumed to repeat.** Steadfast may retry, and a retry that appends a second identical row would show the operator a timeline that stutters. Each event therefore carries a `dedupeKey` built from the shipment, the notification type, the courier's own `updated_at` and a bounded slice of the message, with a unique constraint doing the enforcing — a duplicate delivery collides and is skipped rather than being detected by a read-then-write that two concurrent deliveries could both pass.

The key is a stored column rather than a unique index across those four fields directly: `trackingMessage` is unbounded text, and a btree unique index over it would fail on a long value at insert time — the worst moment to discover a size limit.

### 8. Courier ownership is enforced in `shipment.service.ts`

Rather than a separate model or a status flag, the existing manual update path gains one guard: if the shipment carries a `consignmentId`, reject writes to `trackingNumber`, `carrier`, `status`, `shippedAt` and `deliveredAt`.

The alternative — letting both paths write and having last-write-win — produces a panel that disagrees with both the courier and the operator, which is worse than a control that visibly refuses. Non-courier shipments keep every capability they have today, including the timestamp-clearing behaviour added earlier.

### 9. Over-length addresses are refused, never truncated

A composed address over 250 characters is a validation failure reported to the operator, not something the mapper shortens to fit. Truncation produces an address that looks plausible, passes Steadfast's validation, and delivers the parcel nowhere — the most expensive possible outcome, discovered a week later.

Composition order is `addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, joined by commas with empty parts dropped. `country` is omitted: Steadfast is domestic-only and it would consume characters against the limit for no information.

### 10. Dispatch advances the order to `SHIPPED`

The parcel has left. Leaving it `PACKED` would mean the orders list cannot distinguish a boxed parcel on the bench from one in a courier's van, which is the distinction the operator most needs while dispatching in bulk.

This is written through the existing order status path so `OrderStatusHistory` records it, and it means an order cancelled after dispatch follows the existing `SHIPPED` cancellation rules rather than any new ones.

## Risks / Trade-offs

**A retry after an unclear failure creates a duplicate consignment** → The unique constraint on `consignmentId` cannot prevent this, since a duplicate gets a *different* id. The real defences are layered: dispatch refuses any order that already has a consignment; batch results are persisted before the next batch is sent; timeouts are reported as unconfirmed rather than failed; and unconfirmed invoices can be resolved against `status_by_invoice` before any retry.

**Steadfast becomes a runtime dependency of fulfilment** → Every call is bounded by an explicit timeout, and failure is always reported per order rather than as a page-level error. Manual shipment entry stays fully functional for shipments with no consignment, so a Steadfast outage degrades the panel to what it does today rather than blocking fulfilment.

**Sync falls behind at volume** → Each run processes a bounded slice, so a large backlog is slow rather than broken. If it proves too slow, the cron interval shortens before the batch size grows — the 30-second ceiling is the harder limit.

**Webhook deliveries are missed or replayed** → Missing one is why the scheduled reconciliation exists at all (Decision 7); it looks specifically for consignments that have gone quiet. A replay collides on `dedupeKey` and is skipped, and applying a status twice is a no-op, so a duplicate delivery changes nothing.

**The webhook endpoint is public and unauthenticated by default** → It sits outside `checkAuth` by necessity — Steadfast has no session — so the bearer token is the whole boundary. It is compared in constant time, the endpoint accepts only the two documented notification types, and it acts solely on a `consignment_id` that already exists in our database. A forged call can therefore at worst replay a state onto a consignment we already own; it cannot create one, and it cannot name an order it does not already match.

**A forged webhook could mark an order delivered** → The token prevents it, but the blast radius is bounded regardless: `delivered` advances an order's status, which is reversible by staff, and never moves money or stock. Nothing in the webhook path issues a refund or a restock.

**Order status now moves without a human** → Only in one direction and only into `DELIVERED`, and every transition is written to `OrderStatusHistory` with the sync job as its actor, so an unexpected status is traceable rather than mysterious.

**A courier cancellation leaves stock overstated until someone acts** → Accepted deliberately. The parcel is in transit back; restocking on the courier's signal would advertise goods the shop does not hold. The mitigation is visibility — the order is surfaced as needing attention rather than quietly left in `SHIPPED`.

**The cron secret is a shared credential** → Same exposure as `STOREFRONT_REVALIDATE_SECRET` already carries. Worst case is an attacker causing extra status polls; the endpoint neither creates consignments nor accepts a body that steers what it reads.

## Migration Plan

1. Additive migration adding four nullable columns to `Shipment` and the new `CourierTrackingEvent` table. Existing rows keep every current behaviour with all four null, and no backfill is required or possible.
2. Deploy with `STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`, `STEADFAST_BASE_URL`, `COURIER_SYNC_SECRET` and `STEADFAST_WEBHOOK_TOKEN` set. Without them courier endpoints report themselves unconfigured and everything else is unaffected.
3. Add the cron entry to `vercel.json` only after dispatch has been verified, so nothing polls before there is anything to poll.
4. Register the webhook in Steadfast's portal — callback URL `<api-origin>/api/v1/courier/webhook`, auth token matching `STEADFAST_WEBHOOK_TOKEN` — **last**, after the endpoint is deployed and answering. Registering it against an endpoint that 404s means real status notifications are dropped with no record that they were sent.
5. Update the Postman collection and run `verify:postman`.

**Rollback:** remove the cron entry and unset the credentials — the courier endpoints then refuse cleanly and manual shipment entry is untouched. The columns stay; dropping them would discard the consignment ids of parcels already in transit, which are the only record tying those orders to Steadfast.

## Open Questions

These are verifiable against the live API during implementation and change neither the specs nor the approach:

- The exact key of the bulk response array, and whether a wholly rejected batch returns a per-item array or a top-level error. The mapper must handle both; only the parsing detail is unknown.
- Whether Steadfast enforces an undocumented rate limit. Sequential batches are chosen partly on this uncertainty; a documented limit would only allow relaxing it.
- Whether `status_by_invoice` returns a consignment id, which would make reconciliation of an unconfirmed dispatch a single call per order instead of a manual portal check.
- Whether Steadfast retries a webhook delivery that did not return 200, and how many times. The reconciliation job covers us either way; knowing would only let us tune how aggressively it looks for silence.
- Whether `tracking_update` notifications carry states the `delivery_status` vocabulary does not, which would make the event history the only place some transitions appear.
