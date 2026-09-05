## Context

See proposal.md — *Why*. What shapes the approach here is what already exists in the three apps:

- **`analytics` module** (`server/src/app/module/analytics/`) answers six fixed questions over a `7d | 30d | 90d` window, returns pre-aggregated series and breakdowns, and is guarded to `OWNER | ADMIN | STAFF`. It defines revenue as `sum(Order.totalAmount) where status != CANCELLED`, bucketed on `createdAt`. Reports must not contradict that number.
- **`QueryBuilder`** (`server/src/app/utils/QueryBuilder.ts`) is the shared paged-list helper. It wraps *one* Prisma delegate, filters through a per-call allow-list (params outside it are silently dropped — see the warning comment in `audit-log.service.ts`), and returns `{ data, meta }`. It has no aggregation, no grouping, and no cross-table union.
- **Stock is stored twice.** `Stock` rows hold `(warehouseId, productId, variantId) → quantity, reservedQuantity` and are the location-aware truth. `Product.stockQuantity` and `ProductVariant.stockQuantity` are denormalized mirrors maintained alongside them by `stock.service.ts` (see its header comment). They can drift.
- **`Payment` has no supplier counterpart.** `PurchaseOrder` carries `subtotal / shippingCost / taxAmount / totalAmount` and no settlement concept at all.
- **Admin auth is httpOnly cookies**; every call goes through `request.ts` with `credentials: 'include'`, and that helper always `JSON.parse`s the response.
- **No CSV, no file download, and no date-range control exist anywhere** in server, admin or frontend. `antd` (with its bundled `dayjs`) and `recharts` are already admin dependencies; `date-fns` is already a server dependency.

## Goals / Non-Goals

**Goals**

- One reporting module on the server that owns every report, with money arithmetic done in Postgres rather than in JavaScript.
- The dashboard's revenue number and the Sales report's revenue number provably equal — enforced structurally, not by convention.
- Exports bounded in server memory regardless of result size, so a year-wide export cannot take the process down.
- Supplier payments added as the smallest table that makes Payment history honest.

**Non-Goals**

- No change to `analytics`' endpoints, response shapes or callers. The dashboard keeps working exactly as it does.
- No abstraction layer over the five reports. They share a date-range parser, a CSV writer and a page shell; they do not share a generic "report engine" — five hand-written queries are clearer than one configurable one.
- No caching or materialized aggregates. Every report is computed on request.
- No accounting semantics (see proposal.md — *Explicitly not in scope*).

## Decisions

### 1. A new `report` module rather than extending `analytics`

**Decision.** Add `server/src/app/module/report/` with its own route, controller, service, interface and validation files. Leave `analytics` untouched.

**Why.** The two have different shapes at every level: `analytics` takes an enum window and returns chart-ready aggregates with no row detail; reports take an arbitrary `from`/`to`, return paged detail rows *and* whole-result totals, accept many filters, and export. Bolting arbitrary ranges, paging, filters and CSV onto six endpoints whose callers all pass `range=30d` would mean six signature changes and six risk points on a working dashboard, for no gain.

**Alternative considered.** Generalise `analytics` into one reporting service and have the dashboard call it with fixed arguments. Rejected: it makes every dashboard load depend on the reporting query builder, and the dashboard's fixed queries are hand-tuned for its exact shape.

### 2. One shared definition of "a sale", imported by both modules

**Decision.** Move the revenue predicate into `server/src/app/constants/sales.constant.ts`:

- `SALES_ORDER_WHERE` — the `status: { not: OrderStatus.CANCELLED }` predicate.
- `SETTLED_PAYMENT_STATUSES` — the statuses that count as money actually received (`PAID`, and `PARTIALLY_REFUNDED`, which is money received that was later partly returned).

`analytics.service.ts` and `report.service.ts` both import it. Neither restates the rule.

**Why.** `admin-reporting/sales-reports` requires that the two never state different revenue for the same window. A comment saying "keep these in sync" is not a mechanism. A shared constant makes divergence require editing one place that breaks both.

**Trade-off.** This is the one edit to `analytics.service.ts` in this change — a pure substitution of an inline literal for an imported constant, with no behavioural change.

### 3. Reports bypass `QueryBuilder` and query Prisma directly

**Decision.** The report service writes its own `where` clauses, `groupBy`s and `aggregate`s. `QueryBuilder` is not used for any report.

**Why.** Its allow-list drops unknown params silently, which for a report means confidently returning a wrong number instead of an error — the exact failure `audit-log.service.ts` already documents. It also wraps a single delegate, and every report here reads two or more tables. Reports validate their inputs with Zod through the existing `validateRequest` middleware, so an unknown or malformed filter is a 400, never a silently unfiltered result.

### 4. Payment history is one SQL `UNION ALL`, not two queries merged in JavaScript

**Decision.** Payment history runs a single parameterised `prisma.$queryRaw` that `UNION ALL`s a projection of `Payment` (money in) with a projection of `SupplierPayment` (money out), ordered, paged and totalled in Postgres. Rows are validated by a Zod schema at the boundary before leaving the service.

**Why.** Prisma has no cross-model union. The JavaScript alternative — fetch `offset + limit` from both tables, merge, slice — either over-fetches badly on later pages or paginates incorrectly, and cannot compute whole-result totals without a third and fourth query. One SQL statement gets correct ordering, correct paging and correct totals together.

**Alternative considered.** A `MoneyMovement` table written on both payment paths, so the union is precomputed. Rejected: it duplicates rows that already exist in two tables and introduces a sync bug class (a payment recorded but its movement row not written) in exchange for a query this size does not need.

**Risk mitigation.** Raw SQL loses Prisma's typing and, done carelessly, its injection safety. Every value is bound through `Prisma.sql` parameters; nothing is string-interpolated. Sort direction and column come from a closed allow-list mapped to literal SQL fragments, never from request text.

### 5. Effective payment date is `COALESCE(paidAt, createdAt)`

**Decision.** A payment falls in the period of `paidAt` when it has one and `createdAt` when it does not, and every row carries an `isSettled` flag so the UI can mark an unsettled row's date as a record date.

**Why.** `Payment.paidAt` is nullable and stays null for an uncollected COD payment, which is precisely the row a merchant is hunting for. Dating everything by `createdAt` would put a payment recorded in February and settled in March in the February report; dating only by `paidAt` would drop every unsettled payment out of the report entirely. `admin-reporting/payment-reports` requires both to be visible and correctly placed.

### 6. The Stock report is driven from products, not from `Stock`

**Decision.** Page over `Product`/`ProductVariant` (the filterable, searchable, always-present side), then batch-load the `Stock` rows for that page's ids and fold them in. Whole-result figures — total cost value, total retail value, low-stock count, unvalued-item count — are separate aggregate queries over the same filter, not sums of the page.

**Why.** `admin-reporting/stock-reports` requires an item that has never received stock to appear with zeros. Driving from `Stock` would omit exactly those rows — the ones a merchant most wants to see. Prisma cannot express the left-join-and-aggregate this needs in one call, and `report-shell` requires summary totals to be independent of the page anyway, so the totals are separate queries regardless.

**Consequence.** The mismatch check (`Product.stockQuantity` vs `sum(Stock.quantity)`) falls out for free, because both numbers are already in hand on the same row. The "mismatched only" filter is a `$queryRaw` predicate, since Prisma cannot compare two columns in a `where` — the same limitation `analytics.service.ts` already works around for low stock.

### 7. CSV is `format=csv` on the same endpoint, streamed in batches

**Decision.** Each report endpoint accepts `format=csv`. With it, the handler sets `text/csv` and `Content-Disposition: attachment`, then writes the header row followed by cursor-paged batches of 1,000 rows straight to the response, flushing each batch. No page/limit is applied; every matching row is written.

**Why the same endpoint.** A separate `/export` route would duplicate the entire filter and validation surface of each report and could drift from it — the export would then be answering a subtly different question than the screen, which is the one thing `report-shell` forbids.

**Why a query parameter, not `Accept`.** The parameter is visible in the audit entry and reproducible from a copied URL; content negotiation on a download is not.

**Why streaming.** It caps server memory at one batch no matter how many rows match, so the spec's "every matching row" needs no row limit to stay safe. The trade-off is that once the first byte is sent the status code is committed; a mid-stream failure ends a truncated file. Mitigated by writing the header row only after the first batch query has succeeded, which is when nearly all failures surface.

**Escaping.** A ~12-line writer: wrap in double quotes and double any embedded quote when a value contains `,`, `"`, `\r` or `\n`. Amounts are emitted as bare decimals with no currency symbol or thousands separator so a spreadsheet reads them as numbers. `\r\n` line endings and a UTF-8 BOM, so Excel opens Bangla text and the escaping correctly.

### 8. The admin downloads CSV as a blob, not via a link

**Decision.** Add `admin/src/lib/utils/download.ts` with a `downloadFile(path, filename)` that `fetch`es with `credentials: 'include'`, reads a `Blob`, and triggers a download through an object URL it then revokes.

**Why.** `request.ts` always `JSON.parse`s and would throw on CSV, so it cannot be reused. A plain `<a href>` to the API origin is a cross-origin top-level navigation whose cookie delivery depends on the session cookie's `SameSite` value — it would work in some deployments and silently 401 in others. Fetching with explicit credentials behaves identically everywhere.

**Trade-off.** The browser holds the whole file in memory. For CSV at this scale that is megabytes, and it buys deployment-independent auth.

### 9. `SupplierPayment` gets its own method enum

**Decision.** A new `SupplierPaymentMethod` enum (`CASH`, `BANK_TRANSFER`, `CHEQUE`, `BKASH`, `NAGAD`, `ROCKET`, `CARD`, `OTHER`) rather than reusing `PaymentMethod`.

**Why.** `PaymentMethod` contains `COD`, `STRIPE` and `PAYPAL`, which cannot describe money leaving the store, and lacks `CASH` and `CHEQUE`, which are how most supplier payments in this market actually happen. `inventory/supplier-payments` requires that customer-only methods are not offered; a shared enum would make that a runtime filter that a direct API call could bypass, instead of a type the database rejects.

**Shape.** `SupplierPayment { id, purchaseOrderId, supplierId, amount Decimal(12,2), method, reference String?, paidAt DateTime, note String?, createdAt, updatedAt }` with indexes on `purchaseOrderId`, `supplierId`, `paidAt` and `method` — mirroring `Payment`'s index set. `supplierId` is denormalized from the purchase order so Payment history can filter by supplier without a join, and is set by the service from the PO, never from the request body.

### 10. Overpayment is prevented inside a transaction, not by a check-then-write

**Decision.** Recording a supplier payment runs in a `prisma.$transaction` that re-reads the purchase order and the sum of its existing payments, compares against the incoming amount, and either inserts or throws.

**Why.** `inventory/supplier-payments` requires that two concurrent payments cannot together exceed the balance. A read outside the transaction followed by a write is exactly the race that requirement names.

### 11. `amountPaid` / `balanceDue` are computed, not stored

**Decision.** Purchase order reads compute `amountPaid` as a sum over `SupplierPayment` and `balanceDue` as `totalAmount - amountPaid`. No denormalized column.

**Why.** The mismatch problem in decision 6 is what a denormalized total looks like a year later. Payments against a single PO number in the ones, and both the list and the detail endpoint already fan out to related rows, so this is a `groupBy` over an indexed column — not a cost worth a consistency risk.

### 12. Reports are `OWNER | ADMIN | STAFF`, matching `analytics`

**Decision.** `router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF))` on the report and supplier-payment routers, and no `roles` key on the admin nav section — so all three panel roles see Report.

**Why.** Cost price and supplier balances are the sensitive part, and STAFF can already read both today on the Purchase Order and Product pages. Restricting the report while leaving the source pages open would be theatre. Narrowing STAFF's access to cost data is a coherent change, but it is a change to those existing pages, not to this one.

### 13. Date range control is two native date inputs plus presets

**Decision.** `admin/src/features/reports/components/report-date-range.tsx` renders two `<input type="date">` and five preset buttons (Today, 7 days, 30 days, This month, Last month). No date library is involved anywhere in the reports code.

**Why.** This decision originally specified antd's `DatePicker.RangePicker`, on the grounds that antd already supplies this app's form controls and `dayjs` ships with it for free. **That premise was wrong and the implementation corrected it:** under pnpm's strict `node_modules` layout `dayjs` is antd's own dependency and is not hoisted, so `import dayjs from 'dayjs'` does not resolve. Using the antd control would have meant adding `dayjs` as a direct dependency, which the proposal rules out.

Native date inputs turn out to be the better fit regardless. They produce and consume `YYYY-MM-DD` strings directly — exactly the wire format the API takes — so the conversion layer the antd version needed disappears entirely. `min`/`max` on the two inputs stop them crossing, so the server's rejection of a backwards range stays a backstop rather than the merchant's first hint. The presets are five object literals.

**Alternative considered.** Adding `dayjs` explicitly. Rejected: it buys a nicer calendar popover in exchange for a dependency line and a date library in the bundle, for a control that needs to emit two date strings.

### 14. Range boundaries are resolved on the server, in one timezone

**Decision.** The client sends `from` and `to` as `YYYY-MM-DD` date strings. The server expands them to `[start of from-day, end of to-day]` using a single configured store timezone, and echoes the resolved instants back in the response.

**Why.** `report-shell` requires that a record dated at the last moment of the end date is included. If the client sent instants derived from the browser's timezone, the same range run from two machines would return different totals and neither would be wrong. Echoing the resolved boundaries makes the report self-describing and makes an off-by-one reproducible instead of arguable.

## Risks / Trade-offs

- **A raw `UNION ALL` bypasses Prisma's type safety; a schema change could silently break Payment history.** → The result is parsed by a Zod schema before leaving the service, so a shape change fails loudly with a clear message rather than producing wrong rows. The two column lists sit adjacent in one file, so a field added to one side is visibly missing from the other.

- **Reporting queries scan large date ranges and could be slow or lock-contended on a busy store.** → Every predicate lands on an existing index (`Order.createdAt`, `Payment.createdAt`, `PurchaseOrder.createdAt`/`supplierId`, `StockMovement.createdAt`/`productId`/`type`), and `SupplierPayment` ships with matching ones. Aggregation happens in Postgres, so a 90-day sales summary returns rows in the tens, not the tens of thousands. The known weak spot is Stock history over *all* products with a wide range; its opening balance is a single aggregate over movements before the range, which is index-covered, and detail rows stay paged.

- **`Decimal` money summed as JavaScript numbers loses precision.** → All sums are done by Postgres (`_sum` / SQL `SUM`); conversion to `number` happens once at the response boundary through the existing `round2`, exactly as `analytics.service.ts` already does. No report adds `Decimal`s in JavaScript.

- **A streamed export that fails mid-flight leaves a truncated file that looks complete.** → The header row is written only after the first batch query succeeds, which is where connection and permission failures surface. A later mid-stream failure is logged server-side and aborts the response, which the browser surfaces as a failed download. Accepted: the alternative is buffering the whole file, which reintroduces the memory ceiling this decision exists to remove.

- **Refusing to cancel a purchase order that has payments (per `inventory/supplier-payments`) is stricter than today's behaviour.** → It only bites purchase orders with recorded payments, and no such payment can exist before this change ships, so no existing purchase order changes behaviour. The refusal message names the payments that must be removed first.

- **Stock report valuation is incomplete wherever `costPrice` is null.** → Rather than hide this, the report excludes those rows from the cost total and states how many items and units were excluded, and the spec requires it. This is why no profit figure is offered anywhere in this change.

- **Two pages now read `StockMovement` (Inventory → Stock Movements, Report → Stock history) and could drift into inconsistent labels.** → The movement type labels and colour variants already live as maps in `stock-movements-page.tsx`; they move to a shared module under `admin/src/features/reports/components/` — or rather, into `admin/src/lib/utils/`, since both features import it — and both pages read the same map.

## Migration Plan

1. **Schema first, independently deployable.** Add `SupplierPayment` and `SupplierPaymentMethod`, run the migration. Purely additive — no existing table, column or enum is altered, so the running server is unaffected until code ships.
2. **Server.** Add the `supplier-payment` module and mount it at `/purchase-orders/:id/payments`; add `amountPaid`/`balanceDue` to purchase order reads (additive response fields, so the existing admin build keeps working); add the `report` module; extract `sales.constant.ts` and point `analytics.service.ts` at it.
3. **Admin.** Ship the Purchase Order payments card first (it makes the new table useful on its own), then the Report section.
4. **Postman.** Every new endpoint added to all three collections; `pnpm -C server verify:postman` must pass before the change is considered done.

**Rollback.** Removing the admin `Report` nav section hides the whole feature with one edit and no data implication. The server endpoints are all new and additive; leaving them mounted is harmless. The only irreversible piece is the `SupplierPayment` table, which holds data a merchant entered — a rollback drops the code, not the table.

## Open Questions

- **Which timezone is "the store's"?** Decision 14 needs one value. `StoreSetting` has no timezone column today. The implementation should read a timezone from configuration with `Asia/Dhaka` as the fallback, and adding a merchant-editable store timezone is left to its own change. This does not affect any spec requirement or task boundary — only which constant the range resolver reads.
