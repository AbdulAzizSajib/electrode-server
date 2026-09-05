## Why

The admin panel can tell a merchant what is happening *right now* — Orders lists today's orders, Stock lists today's quantities, Purchase Orders lists today's POs — but it cannot answer a single question about a period. "How much did we sell last month?" "What did we buy from this supplier this quarter?" "How did this SKU get from 40 units to 6?" "Which customers still owe us money?" Every one of those is a manual export-and-tally job today, because there is nowhere in the panel that takes a date range.

The dashboard is the closest thing, and it is deliberately not a report: `analytics.service.ts` answers six fixed questions over a fixed `7d | 30d | 90d` window, returns pre-aggregated chart data, and has no row detail, no filters beyond the window, and no export. It is a glanceable summary and should stay one.

There is also a hole in the data itself. `Payment` records what a *customer* paid against an `Order`, but nothing records what the store paid a *supplier*. `PurchaseOrder` carries a `totalAmount` and no notion of settlement, so a merchant who has received ৳50,000 of goods and paid ৳30,000 of them has no place to record the ৳30,000 and no way to see the ৳20,000 outstanding. A payment history that showed only one side of the money would be misleading, so this change closes that hole.

## What Changes

### A new top-level **Report** section in the admin panel

A sixth parent menu (between Sales and Marketing) with five children, each a full page with a date range, filters, pagination, and CSV export:

- **Stock report** — the current stock position: every product/variant, its quantity per warehouse and in total, reserved vs available, stock value at cost and at retail, and a low-stock flag. A position, not a period — the date range does not apply and the page does not offer one.
- **Sales report** — orders in a date range, summarised and itemised. Gross sales, discounts, shipping, tax, order total, amount collected, amount outstanding, and amount refunded. Groupable by day, product, category, or payment method.
- **Purchases report** — purchase orders in a date range, by supplier and by status: quantity ordered vs received, purchase value, amount paid, and amount still owed.
- **Stock history** — the movement ledger for a chosen product (or all products) over a date range, with a running balance: **opening → in → out → closing**. This is the question the existing Stock Movements page cannot answer — it is an unbounded reverse-chronological feed with no opening balance and no arithmetic.
- **Payment history** — every money movement in a date range, **both directions**: customer payments received against orders, and supplier payments made against purchase orders. Filterable by direction, method, and status.

### Supplier payments become recordable

A new `SupplierPayment` model records a payment made to a supplier against a purchase order — amount, method, reference, date, note. It is written from a **Record payment** action on the Purchase Order detail page, mirroring the existing **Record payment** action on the Order detail page (`order-detail-page.tsx`), and the PO detail page grows the same "paid / balance due" summary the order page has.

**This is deliberately not double-entry accounting.** No chart of accounts, no journal, no debit/credit columns, no trial balance. A supplier payment is one row saying "we paid this supplier this much against this PO on this date" — enough to make Payment history honest and to compute an outstanding balance, and nothing more. A real ledger, if it is ever wanted, is its own change.

### CSV export

Every report page gets an **Export CSV** button that exports the **currently applied filters and date range across all matching rows** — not just the visible page. Export is server-rendered so a 40,000-row export does not depend on the browser holding 40,000 rows, and every export is written to the audit trail as an `EXPORT` action (`AuditAction.EXPORT` already exists in the enum and is currently unused).

### Explicitly not in scope

- **No debit/credit ledger, no accounting module.** See above.
- **No new dashboard widgets.** The six `/analytics/*` endpoints keep their current shape and callers; reports live beside them, not on top of them.
- **The existing Inventory → Stock Movements page stays exactly where it is and as it is.** It is the operational audit feed; Report → Stock history is the periodic balance-sheet view. Two pages over one table, answering two different questions.
- **No PDF export**, no scheduled/emailed reports, no saved report presets.
- **No profit-and-loss report.** `costPrice` is nullable on both `Product` and `ProductVariant`, so a margin figure would be silently wrong for every product without one. Stock report shows cost *value* with unpriced rows counted separately and labelled; it does not present a profit number.

## Capabilities

### New Capabilities

- `admin-reporting/report-shell`: The Report section itself — that it exists as a parent menu with five children, who may see and reach it, and the contract every report inside it shares: how a date range is chosen and bounded, how filters compose, how paging works, and how CSV export behaves (full result set, current filters, audited).
- `admin-reporting/stock-reports`: The two stock-facing reports — the current-position stock report (per warehouse and in total, reserved vs available, valuation, low-stock) and the stock history ledger (opening → in → out → closing over a range), including which quantity is authoritative and what happens when the denormalized mirrors disagree.
- `admin-reporting/sales-reports`: What counts as a sale and how sales are summarised over a period — the money columns, the four groupings, the treatment of cancelled orders and refunds, and the guarantee that the sales report and the dashboard never state different revenue for the same window.
- `admin-reporting/purchase-reports`: How purchasing is summarised over a period — ordered vs received quantity, purchase value, paid and outstanding amounts, and how a partially-received or cancelled purchase order is counted.
- `admin-reporting/payment-reports`: The two-directional payment history — money in from customers and money out to suppliers in one chronological view, what each row states, how direction/method/status filters behave, and what the totals mean.
- `inventory/supplier-payments`: Recording and correcting a payment made to a supplier against a purchase order, the resulting paid/outstanding balance on that purchase order, and the rules that keep a payment from exceeding or outliving what it settles.

### Modified Capabilities

None. `openspec/specs/` at this root is empty — the two prior changes here (`add-admin-ui-cms-section`, `add-checkout-and-site-settings`) declared `storefront-cms/*` capabilities but were never synced or archived, so there is no existing requirement at this root to amend. The server's `api/inventory` and `api/checkout` specs keep their requirements unchanged: this change reads what they already produce and adds a new table beside them.

## Impact

**Server** (`server/`)

- `prisma/schema/SupplierPayment.prisma` (new) — `purchaseOrderId`, `supplierId`, `amount`, `method`, `reference`, `paidAt`, `note`; plus a `supplierPayments` relation on `PurchaseOrder` and `Supplier`, and a migration.
- `prisma/schema/enums.prisma` — a `SupplierPaymentMethod` enum (CASH, BANK_TRANSFER, CHEQUE, BKASH, NAGAD, ROCKET, CARD, OTHER). Kept separate from the customer-facing `PaymentMethod` rather than reused: COD/STRIPE/PAYPAL are meaningless for money going out, and CASH/CHEQUE are meaningless for money coming in.
- `src/app/module/report/` (new) — `report.route.ts`, `.controller.ts`, `.service.ts`, `.interface.ts`, `.validation.ts`. Six `GET /reports/*` endpoints (five reports + one CSV variant per report via an `format=csv` parameter), staff-guarded like `analytics.route.ts`.
- `src/app/module/supplier-payment/` (new) — full CRUD-lite module mounted under `/purchase-orders/:id/payments`, mirroring how `payment.route.ts` mounts under `/orders/:id/payments`.
- `src/app/module/purchase-order/purchase-order.service.ts` — PO reads gain `amountPaid` / `balanceDue`.
- `src/app/module/analytics/analytics.service.ts` — **unchanged**; the sales report reuses its revenue rule rather than restating it (the rule moves to a shared constant both import).
- `postman/Ecom.postman_collection.json` — every new endpoint added; `pnpm -C server verify:postman` must pass.

**Admin** (`admin/`)

- `src/routes/nav-config.ts` — a new `Report` section with five children.
- `src/routes/app-router.tsx` — `/reports/stock`, `/reports/sales`, `/reports/purchases`, `/reports/stock-history`, `/reports/payments`.
- `src/features/reports/` (new) — five pages plus shared `components/` (date-range picker, report toolbar, export button, summary tiles).
- `src/features/inventory/purchase-orders/purchase-order-detail-page.tsx` — a Payments card with **Record payment**, matching the order detail page.
- `src/lib/api/reports.ts`, `src/lib/api/supplier-payments.ts` (new); `src/lib/api/query-keys.ts`, `src/lib/api/purchase-orders.ts` extended.
- `src/lib/utils/download.ts` (new) — there is no CSV or file-download helper anywhere in the three apps today.
- `postman/Ecom.postman_collection.json`.

**Frontend** (`frontend/`)

- Untouched. Nothing here is shopper-facing.

**Cross-cutting**

- No new runtime dependency in any app. CSV is generated server-side by hand (comma/quote/newline escaping is a dozen lines) rather than pulling in a formatter.
- Reporting queries run against existing indexes: `Order.createdAt`, `Payment.createdAt`, `StockMovement.createdAt` + `productId` + `type`, `PurchaseOrder.createdAt` + `supplierId` are all already indexed. `SupplierPayment` ships with matching indexes.
