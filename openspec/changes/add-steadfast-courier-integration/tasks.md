## 1. Schema and configuration

- [x] 1.1 Add `consignmentId` (String?, `@unique`), `courierInvoice` (String?), `courierStatus` (String?) and `courierSyncedAt` (DateTime?) to `prisma/schema/Shipment.prisma`, with a doc comment on `courierStatus` explaining why the courier's raw value is kept beside the `status` enum (design Decision 3)
- [x] 1.2 Add an index on `courierStatus` to serve the sync job's "non-terminal consignments" query
- [x] 1.3 Run `pnpm migrate` to generate the additive migration; confirm every existing shipment row keeps working with all four columns null
- [x] 1.4 Add `STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`, `STEADFAST_BASE_URL` (default `https://portal.packzy.com/api/v1`) and `COURIER_SYNC_SECRET` to `src/app/config/env.ts`, all optional so an unconfigured deployment still boots
- [x] 1.5 Document the same four variables in `.env.example`, noting that credentials deliberately do not live in store settings (design Decision 1)
- [x] 1.6 Add a `CourierTrackingEvent` model (shipment relation, `notificationType`, `status`, `trackingMessage`, `codAmount`, `deliveryCharge`, `courierUpdatedAt`, `receivedAt`, `dedupeKey @unique`) and migrate (design Decision 11)
- [x] 1.7 Add `STEADFAST_WEBHOOK_TOKEN` to `env.ts` and `.env.example`, optional, with the webhook endpoint refusing every call when it is unset

## 2. Steadfast HTTP client

- [x] 2.1 Create `src/app/module/courier/steadfast.client.ts` with the three required headers, the configured base URL, and an explicit per-call timeout
- [x] 2.2 Throw a distinct, catchable error when credentials are unset, so callers can report "not configured" rather than surfacing a 401 from Steadfast
- [x] 2.3 Distinguish three outcomes on every call: success, a definite failure (reached Steadfast, got a rejection), and an unconfirmed outcome (timeout or unreadable response) — mirroring `frontend/src/lib/api-proxy.ts` (design Decision 6)
- [x] 2.4 Implement `createBulkOrders`, `getStatusByConsignmentId`, `getStatusByInvoice`, `getBalance` and `createReturnRequest`
- [x] 2.5 Make the bulk response parser tolerate both a per-item result array and a top-level error envelope (design Open Questions)

## 3. Order-to-consignment mapping

- [x] 3.1 Add a Steadfast phone formatter to `src/app/utils/phone.ts` converting stored E.164 to 11-digit local form, returning null for anything unconvertible
- [x] 3.2 Create `courier.mapper.ts` composing `recipient_address` from `addressLine1`, `addressLine2`, `city`, `state`, `postalCode` — comma-joined, empty parts dropped, `country` omitted (design Decision 9)
- [x] 3.3 Compute `cod_amount` as order total less payments already recorded `PAID`, yielding 0 for a fully prepaid order
- [x] 3.4 Map `invoice` from `orderNumber` and `recipient_name` from the shipping address's `fullName`, falling back to the customer's name
- [x] 3.5 Write unit-style assertions for the mapper in a `scripts/verify-courier-mapping.ts` covering: E.164 conversion, a 0 COD prepaid order, a landing-page order whose zone sits in `state`, and an address at exactly 250 characters

## 4. Pre-flight eligibility

- [x] 4.1 Implement an eligibility check returning a per-order verdict with a specific reason: not `PACKED`, already dispatched, missing shipping address, unconvertible phone, or address over 250 characters
- [x] 4.2 Refuse over-length addresses rather than truncating them (design Decision 9)
- [x] 4.3 Deduplicate repeated order ids within one request before any check runs
- [x] 4.4 Expose the check as `POST /courier/dispatch/preview` so the admin panel can show what will and will not go before anything is sent

## 5. Bulk dispatch

- [x] 5.1 Implement `dispatchOrders(orderIds, actor)`: pre-flight, then chunk eligible orders into batches of 50
- [x] 5.2 Refuse a selection larger than 200 orders with a message telling the operator to split it (design Decision 4)
- [x] 5.3 Persist each batch's results before sending the next batch — never accumulate and write once at the end (design Decision 4; this is the property that makes a timeout recoverable)
- [x] 5.4 Match every result back to its order by `invoice`, never by array position; log and skip an unmatched invoice (design Decision 5)
- [x] 5.5 On success write `consignmentId`, `trackingNumber`, `courierInvoice`, `courierStatus` and `carrier` onto the order's shipment, creating it if the order has none and updating in place if it has a manual one
- [x] 5.6 Advance each successfully dispatched order to `SHIPPED` through the existing order status path so `OrderStatusHistory` records it (design Decision 10)
- [x] 5.7 Report a timed-out batch as unconfirmed rather than failed, listing the invoices that were in flight (design Decision 6)
- [x] 5.8 Write an audit-log entry naming the actor and the orders dispatched
- [x] 5.9 Return a combined per-order result: dispatched, ineligible, failed, or unconfirmed — each with a reason

## 6. Status: webhook, then reconciliation

- [x] 6.1 Implement one shared `applyCourierStatus(shipment, status, observedAt)` that both the webhook and reconciliation call, so the two paths cannot drift (design Decision 7)
- [x] 6.2 Store the raw status in `courierStatus` with `courierSyncedAt`, and derive `ShipmentStatus` conservatively — only `delivered` → `DELIVERED`, only `cancelled` → `RETURNED`, approval-pending values → `IN_TRANSIT` (design Decision 3); compare status case-insensitively
- [x] 6.3 Make applying an already-held status a no-op, so a replayed webhook and a double-fired cron are both inert
- [x] 6.4 On `delivered`, set `deliveredAt` and advance the order to `DELIVERED` through the existing status path
- [x] 6.5 On `cancelled`, record the state and do NOT change order status, stock, or refunds
- [x] 6.6 Add `POST /courier/webhook` accepting `delivery_status` and `tracking_update`, matching by `consignment_id`, acknowledging an unknown consignment with 200 rather than an error
- [x] 6.7 Authenticate the webhook with `STEADFAST_WEBHOOK_TOKEN` as a bearer token, compared in constant time, refusing every call when the token is unconfigured
- [x] 6.8 Append every notification to `CourierTrackingEvent`, building `dedupeKey` from shipment + type + courier timestamp + a bounded slice of the message, and let the unique constraint absorb a replay rather than a read-then-write (design Decision 11)
- [x] 6.9 Implement `reconcileQuietConsignments()` selecting a bounded slice of non-terminal consignments not heard from within a staleness window, querying Steadfast sequentially (design Decision 7)
- [x] 6.10 Leave existing values untouched when a reconciliation query fails, recording the failure instead
- [x] 6.11 Add `POST /courier/sync` guarded by `COURIER_SYNC_SECRET` in a header, rejecting an unauthenticated call before any courier request is made
- [x] 6.12 Warn once, not per request, when the sync secret or webhook token is unconfigured — following `utils/revalidateStorefront.ts`

## 7. Balance, returns and courier-owned shipment guard

- [x] 7.1 Add `GET /courier/balance`
- [x] 7.2 Add `POST /courier/orders/:id/return` accepting an optional reason, refusing an order with no consignment
- [x] 7.3 Guard `shipment.service.ts` `updateShipment`: when the shipment carries a `consignmentId`, reject writes to `trackingNumber`, `carrier`, `status`, `shippedAt` and `deliveredAt`, naming the courier as their source (design Decision 8)
- [x] 7.4 Leave every capability of a non-courier shipment unchanged, including the existing three-state timestamp clearing
- [x] 7.5 Reject `createShipment` for an order that already carries a consignment, as it does today for any existing shipment

## 8. Routing, contract and verification

- [x] 8.1 Create `courier.route.ts` with `checkAuth(OWNER, ADMIN, STAFF)` on every route except `/sync` and `/webhook`, which use the secret and bearer-token guards instead
- [x] 8.2 Add zod schemas in `courier.validation.ts` for the dispatch, preview and return payloads
- [x] 8.3 Mount at `/courier` in `src/app/routes/index.ts` — all segments are literal, so no ordering constraint applies; add a comment saying so
- [x] 8.4 Add every new route to `postman/Ecom.postman_collection.json` and run `pnpm verify:postman` until clean
- [x] 8.5 Write `scripts/verify-courier-dispatch.ts` asserting against a live database, without calling Steadfast: an unpacked order is ineligible, an already-dispatched order is refused a second consignment, a selection over 200 is refused, a mixed selection reports per-order verdicts, and results are matched by invoice when given a deliberately reordered response
- [x] 8.6 Register `verify:courier-dispatch` and `verify:courier-mapping` in `package.json`

## 9. Deployment

- [ ] 9.1 Verify dispatch end to end against Steadfast with a single real order before any cron or webhook exists
- [ ] 9.2 Add the sync cron entry to `vercel.json` only after 9.1 passes (design Migration Plan step 3)
- [ ] 9.3 Register the webhook in Steadfast's portal LAST — callback `<api-origin>/api/v1/courier/webhook`, auth token matching `STEADFAST_WEBHOOK_TOKEN` — only once the endpoint is deployed and answering, so no real notification is dropped against a 404
- [ ] 9.4 Confirm the unconfigured path: with credentials unset, courier endpoints report themselves unconfigured and manual shipment entry is unaffected
