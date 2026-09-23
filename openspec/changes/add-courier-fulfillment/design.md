## Context

See `proposal.md` — Why. What shapes the approach here is what already exists.

`Shipment` (`prisma/schema/Shipment.prisma`) is a thin model: `carrier String?`, `trackingNumber String? @unique`, a `ShipmentStatus`, and two timestamps. `ShipmentService` treats it as one-per-order — `getLatestShipment` takes the newest row and `createShipment` refuses a second — and the admin's shipment dialog is a three-field form whose carrier input is free text.

Order status is governed by `ORDER_STATUS_TRANSITIONS` in `order.service.ts`, a map the service enforces and the admin reads back through `allowedTransitions` so the UI offers exactly what the service will accept. That map is the single authority on what may follow what, and `PACKED → SHIPPED` already exists in it.

The three fulfilment documents render through `print-frame.tsx` into a print-only DOM, with `print.css` hiding admin chrome. Labels are already per-order components taking `{ order, settings, size }`.

Two repo rules bear directly on this work: a new Prisma migration will contain `DROP INDEX` lines for the three `pg_trgm` indexes that must be deleted by hand before committing, and services must never touch `req`/`res` because `scripts/verify-*.ts` import them directly.

## Goals / Non-Goals

**Goals:**

- One courier record referenced by many shipments, replacing free text as the way a courier is named going forward.
- Bulk assignment that is all-or-nothing, so a partially-dispatched selection is never a state anyone has to reconcile.
- Reuse the existing transition map and document components rather than parallel copies of either.

**Non-Goals:**

- Courier API integrations — no rate fetching, no pickup booking, no webhook status sync. A courier here is a record the merchant maintains, not a connection.
- Split shipments. One shipment per order stays the model; a selection assigns one courier per order.
- Backfilling historic `carrier` strings into `Courier` rows. See Decision 2.
- Scan-to-assign, deferred by the proposal.

## Decisions

### Decision 1: `Courier` as its own table, not a JSON block on `StoreSetting`

A settings JSON block would have avoided a migration and followed the partial-PATCH pattern the six existing editors share. It was rejected because a courier is referenced, not merely configured: shipments must point at one, "how many parcels did this courier take" must be answerable, and deletion must be refusable while references exist. None of that is expressible against an array inside a JSON column — there is no foreign key to violate, so an entry could vanish while shipments still named it.

The cost is a migration, and with it the `DROP INDEX` hazard. That is a known, documented procedure; silent referential damage is not.

### Decision 2: `Shipment` keeps `carrier`, and gains `courierId` beside it

The obvious move is to replace `carrier String?` with `courierId String?`. Rejected: existing rows carry free text that no `Courier` row corresponds to, and a migration that drops the column destroys the only record of who carried those parcels.

Instead both columns exist. `courierId` is what new work writes; `carrier` is retained and read-only from here on. Display resolves `courier?.name ?? carrier ?? '—'`, so an old shipment keeps showing "Pathao Courier" and a new one shows its courier's name.

This is deliberately not a migration-with-a-backfill. Matching "pathao", "Pathao" and "Pathao Courier" onto one record is a judgement about the merchant's own data that only the merchant can make, and a fuzzy match that guesses wrong rewrites shipment history silently. Merchants who want their old parcels attributed can reassign them through the UI; those who don't lose nothing.

**Trade-off accepted:** two columns mean per-courier reporting covers `courierId` rows only, and pre-change parcels sit outside it. Reporting is not in this change's scope, and a report over a column with three spellings of one courier would have been wrong anyway.

### Decision 3: Bulk assign is one transaction, and refuses rather than partially applies

The spec requires all-or-nothing. Implementation is a single `prisma.$transaction` that validates every order in the selection first — eligible status, not cancelled, not a collection order, courier active — and throws `AppError` naming the offending orders before writing anything.

The alternative, applying what succeeds and reporting the rest, was rejected for what the failure looks like physically: a rider standing at the counter with a stack of parcels, some of which the system now considers dispatched and some not, and no way to tell which without re-reading each. Refusing outright leaves the merchant with one clear instruction — remove the named orders and retry.

Validation reuses `assertOrderTransitionAllowed` against `ORDER_STATUS_TRANSITIONS`. It is not re-derived: the returns module already produced a bug by letting a UI list statuses independently of the map, and the map's own comment says so.

### Decision 4: Collection orders are refused, not skipped

`deliveryMethod === 'PICKUP'` orders are rejected by the same pre-flight. Skipping them quietly was rejected because the order detail page already treats this as a mistake worth shouting about — it renders a dedicated warning card saying the parcel "is not to be handed to a courier" — and a bulk path that silently dropped such orders would be less careful than the single-order path it sits beside.

### Decision 5: The manifest is a fourth document, not a report

It renders through the existing `print-frame.tsx` with a `PaperSize`, beside `invoice.tsx` / `packing-slip.tsx` / `shipping-label.tsx`, and follows their conventions: no cost basis, chrome excluded, A4 default (it is a list to be signed, not a receipt).

Its data comes from the orders in the selection, so the manifest can be printed at the moment of assignment. It does not require a persisted "consignment" entity — introducing one would mean a second lifecycle to keep in step with shipment status for no behaviour the spec asks for.

### Decision 6: Batch label print repeats the existing component

`ShippingLabel` is already a pure component over one order. The batch route renders N of them into one print frame with a CSS page break between, rather than introducing a separate batch-label layout. This is what makes "identical in content to the single label" true by construction rather than by two implementations agreeing.

Orders that cannot produce a label are collected and surfaced to the user; the rest still print. This differs from bulk assign's all-or-nothing on purpose — an incomplete print run is recoverable by printing again, whereas a partial dispatch corrupts state.

### Decision 7: Bulk selection lives in the orders list, not a new screen

`ResourceListPage`/`DataTable` back ~117 admin pages and have no row-selection concept today. Selection state and the action bar are added to the orders list page locally rather than pushed into the shared table, because every other list would inherit a feature none of them use. If a second list needs selection later, that is the point to generalise it.

## Risks / Trade-offs

- **The migration drops the three `pg_trgm` indexes** → Highest-likelihood failure in this change and it is silent: product search degrades to a sequential scan with no error. Mitigated by the repo's standing procedure — open the generated SQL, delete the `DROP INDEX` lines, carry forward the NOTE block from the previous migration — and by a task calling it out explicitly rather than trusting recall.

- **Two carrier columns are a lasting ambiguity** → Anyone reading `Shipment` later must know which to trust. Mitigated by a `///` doc comment on both columns stating that `carrier` is historical and read-only and that `courierId` is authoritative — the schema comment is the spec of record in this codebase.

- **Bulk assign over a large selection holds one transaction** → A merchant selecting a whole page of orders makes this a multi-row write under lock. Acceptable at admin scale (tens, not thousands), and bounded by an explicit cap on selection size so the transaction cannot grow without limit.

- **All-or-nothing frustrates a merchant with one bad order in fifty** → Real cost, accepted per Decision 3. Mitigated by naming the blocking orders in the error so the fix is one deselection, not a hunt.

- **Deactivating rather than deleting will accumulate couriers** → Minor. The list filters to active by default, so the clutter stays out of the assignment path.

## Migration Plan

1. Add the `Courier` model and `Shipment.courierId` in one migration. Remove the `DROP INDEX` lines, carry the NOTE block forward.
2. Deploy backend before admin. Both new columns are optional and the new endpoints are additive, so the running admin continues to work against the migrated database — the existing shipment dialog keeps writing `carrier`.
3. Deploy admin. The dialog switches to the courier select at this point.

Rollback: the admin reverts independently. The columns are additive and nullable, so a backend rollback needs no data change; `courierId` values written in the interim are simply unread.

## Open Questions

- Whether the manifest should also be reachable from a courier's own page (all parcels currently out with that courier) rather than only from a selection. Deferrable: it is an additional entry point to the same document, and adding it later changes no requirement here.
