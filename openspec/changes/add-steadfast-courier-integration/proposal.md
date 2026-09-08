## Why

Fulfilment stops at the packing bench. An operator prints the label from the order page, then re-types the recipient's name, phone, address and COD amount into Steadfast's own portal by hand — once per parcel. At ten orders a day that is tedious; at the volume this shop is being built for it is the bottleneck, and every re-typed address is a chance to misroute a parcel or collect the wrong amount.

Nothing comes back either. `Shipment.trackingNumber` is a free-text box someone may or may not fill in, so "where is this parcel" is a question the admin panel cannot answer and a customer-service reply nobody can write without opening Steadfast separately.

## What Changes

- **New `courier` module** wrapping Steadfast's API (`https://portal.packzy.com/api/v1`), with credentials read from `STEADFAST_API_KEY` / `STEADFAST_SECRET_KEY` in the environment.
- **Bulk dispatch.** Staff select packed orders in the admin panel and send them in one action. The server validates, chunks, calls Steadfast's bulk endpoint, and records the outcome of every order individually.
- **Pre-flight validation.** An order whose phone or address Steadfast would reject is reported before the call, with the reason, rather than failing halfway through a batch.
- **Delivery status by webhook.** Steadfast pushes `delivery_status` and `tracking_update` notifications to an endpoint authenticated by a bearer token we configure in their portal, so the panel is current within moments rather than on a polling window.
- **Scheduled reconciliation behind it.** A cron-driven job polls only consignments that are non-terminal *and* have gone quiet. A webhook is one delivery attempt with no promised retry, and a missed one is otherwise undetectable — the order just sits shipped forever.
- **Tracking history.** Every notification is appended to a new `CourierTrackingEvent` table rather than overwriting a latest value, so "where has this parcel been" is answerable when a delivery runs late.
- **Courier identity on `Shipment`**: `consignmentId`, `courierInvoice`, `courierStatus` (Steadfast's raw value) and `courierSyncedAt`. **BREAKING** for anything reading `Shipment` as a purely manual record — a courier-owned shipment's `trackingNumber` and `status` become derived, not hand-edited.
- **Balance and return request** endpoints, so a merchant can see their Steadfast balance and raise a return without leaving the panel.
- **Home delivery only.** Steadfast's bulk endpoint accepts no `delivery_type`, so every dispatched consignment takes Steadfast's default (home delivery). Point delivery would force one HTTP call per parcel and is out of scope.
- **PACKED-only dispatch.** Only an order that has been packed may be sent, matching the existing pick → box → label flow.
- **A courier cancellation is flagged, never auto-restocked.** Sync records the state and surfaces it for attention; the operator decides when the parcel is physically back.
- Postman collection entries for every new route, plus `verify:courier-dispatch`.

## Capabilities

### New Capabilities
- `api/courier`: dispatching orders to an external courier and reconciling their delivery state — credential handling, order-to-consignment field mapping, pre-flight eligibility, bulk dispatch with partial success, duplicate-dispatch prevention, scheduled status sync, balance and return requests.

### Modified Capabilities
- `api/post-purchase`: shipment requirements change now that a shipment can be owned by a courier. A courier-owned shipment's tracking number and delivery status are derived from Steadfast and must not be silently overwritten by the existing manual `PATCH /orders/:id/shipment` path, which today accepts any value for either.

## Impact

**Schema** — `Shipment` gains `consignmentId` (unique, nullable), `courierInvoice`, `courierStatus`, `courierSyncedAt`, plus a new `CourierTrackingEvent` table holding one row per notification with a `dedupeKey` unique constraint so a replayed webhook cannot duplicate history. Additive; existing manual shipments keep working with all four null. New migrations under `prisma/migrations/`.

**New code** — `src/app/module/courier/` (route, controller, service, validation, interface, plus a `steadfast.client.ts` and a field-mapping module). Mounted at `/api/v1/courier`; registration in `src/app/routes/index.ts` needs no ordering care, as all of its segments are literal.

**Existing code** — `shipment.service.ts` gains a guard against hand-editing courier-owned fields. `src/app/config/env.ts` gains the two credentials plus a base URL, a cron secret and a webhook token. `src/app/utils/phone.ts` gains a Steadfast-format converter (the DB stores E.164; Steadfast requires 11 local digits).

**Deployment** — the reconciliation job cannot use `node-cron`: this server runs as a Vercel function, where no long-lived process survives between requests. It must be a protected endpoint driven by Vercel Cron, declared in `vercel.json`. The same file's `maxDuration: 30` bounds how many orders one dispatch call can carry. The webhook must be registered in Steadfast's portal only after the endpoint is deployed and answering — registering it against a 404 drops real notifications with no record they were sent.

**External dependency** — Steadfast becomes a runtime dependency of fulfilment. Every call site must treat it as untrusted and slow: a dispatch that times out may still have created consignments.

**Out of scope** — point delivery, split shipments (the one-shipment-per-order rule stands), automatic restocking on courier cancellation, storefront-facing courier tracking, and any second courier. The module is written for Steadfast specifically, not as a carrier abstraction.
