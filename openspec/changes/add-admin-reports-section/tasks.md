## 1. Schema — supplier payments

- [x] 1.1 Add `SupplierPaymentMethod` enum (`CASH`, `BANK_TRANSFER`, `CHEQUE`, `BKASH`, `NAGAD`, `ROCKET`, `CARD`, `OTHER`) to `server/prisma/schema/enums.prisma`, with a comment stating why it is separate from `PaymentMethod` (design decision 9)
- [x] 1.2 Add `server/prisma/schema/SupplierPayment.prisma` with the fields and indexes from design decision 9, and a doc comment on `supplierId` explaining it is denormalized from the purchase order and set by the service, never from the request
- [x] 1.3 Add the `supplierPayments` back-relations to `PurchaseOrder.prisma` and `Supplier.prisma`
- [x] 1.4 Generate and apply the migration; confirm it is purely additive (no altered table, column or enum)

## 2. Server — supplier payment module

- [x] 2.1 Create `server/src/app/module/supplier-payment/supplier-payment.interface.ts` and `.validation.ts` — create and update schemas covering amount (positive), method (enum), `paidAt`, optional `reference` and `note`
- [x] 2.2 Implement `supplier-payment.service.ts` `recordPayment` inside a `prisma.$transaction` that re-reads the purchase order and the sum of its payments, rejects DRAFT and CANCELLED purchase orders, and rejects an amount that would push total paid above `totalAmount` (design decision 10)
- [x] 2.3 Implement `listPayments`, `updatePayment` and `deletePayment`; the update path re-runs the same overpayment check excluding the payment being amended
- [x] 2.4 Call `AuditLogService.record` after each successful create, update and delete, following the existing post-mutation, non-transactional convention
- [x] 2.5 Create `supplier-payment.controller.ts` and `supplier-payment.route.ts` with `Router({ mergeParams: true })` and `checkAuth(OWNER, ADMIN, STAFF)`, mirroring `payment.route.ts`
- [x] 2.6 Mount at `/purchase-orders/:id/payments` in `server/src/app/routes/index.ts`, before the `/purchase-orders` mount
- [x] 2.7 Verify against `inventory/supplier-payments`: zero/negative rejected, overpayment rejected with the balance named, exact settlement accepted, draft and cancelled rejected, unauthenticated and customer sessions rejected

## 3. Server — purchase order settlement figures

- [x] 3.1 Add `amountPaid` and `balanceDue` to purchase order detail and list reads in `purchase-order.service.ts`, computed by `groupBy` over `SupplierPayment` (design decision 11)
- [x] 3.2 Add a settlement state (`UNPAID` / `PARTIALLY_PAID` / `SETTLED`) to purchase order list rows, and a filter for purchase orders with a balance owing
- [x] 3.3 Refuse to cancel a purchase order that has supplier payments, with a message naming how many payments must be removed first
- [x] 3.4 Verify against `inventory/supplier-payments`: sum of payments equals `amountPaid`, `totalAmount − amountPaid` equals `balanceDue`, a purchase order with no payments reads 0 paid and full balance due

## 4. Server — shared reporting foundation

- [x] 4.1 Create `server/src/app/constants/sales.constant.ts` exporting `SALES_ORDER_WHERE` and `SETTLED_PAYMENT_STATUSES` (design decision 2)
- [x] 4.2 Replace the inline `status: { not: CANCELLED }` literals in `analytics.service.ts` with the imported constant; confirm every existing `/analytics/*` response is byte-identical before and after
- [x] 4.3 Create `server/src/app/module/report/report.validation.ts` — a shared range schema (`from`/`to` as `YYYY-MM-DD`, `to` not before `from`), a shared paging schema, and `format=csv`
- [x] 4.4 Add a range resolver that expands `from`/`to` to inclusive instants in the store timezone (config value, fallback `Asia/Dhaka`) and returns the resolved boundaries for echoing back (design decision 14)
- [x] 4.5 Add a CSV writer utility — quote-escaping for `,` `"` `\r` `\n`, `\r\n` line endings, UTF-8 BOM, bare decimal amounts (design decision 7)
- [x] 4.6 Add a streaming export helper that sets `text/csv` and `Content-Disposition`, writes the header row only after the first batch query succeeds, then writes 1,000-row batches until exhausted
- [x] 4.7 Create `report.route.ts` and `report.controller.ts` with `checkAuth(OWNER, ADMIN, STAFF)`; mount at `/reports` in `routes/index.ts`
- [x] 4.8 Record an `EXPORT` audit entry naming the report, resolved range and applied filters on every CSV response, and nothing on a JSON response (`admin-reporting/report-shell`)

## 5. Server — stock report

- [x] 5.1 Implement `GET /reports/stock`: page over `Product`/`ProductVariant`, batch-load their `Stock` rows, return per-item on-hand, reserved and available, with the per-warehouse split (design decision 6)
- [x] 5.2 Add the warehouse filter (one warehouse or all), search, and category/brand filters
- [x] 5.3 Compute whole-result totals as separate aggregates: cost value, retail value, low-stock count, and the count of items and units excluded from the cost total for want of a `costPrice`
- [x] 5.4 Implement the variant→product price and cost fallback for valuation
- [x] 5.5 Add the cached-quantity mismatch flag and the "mismatched only" filter as a `$queryRaw` column comparison
- [x] 5.6 Wire the CSV variant
- [x] 5.7 Verify against `admin-reporting/stock-reports`: item with no stock record appears with zeros, variants reported individually, warehouse split sums to total, cost total excludes unpriced items and states the exclusion, low-stock boundary is at-or-below

## 6. Server — stock history report

- [x] 6.1 Implement `GET /reports/stock-history`: opening balance as a signed aggregate over movements before the range, quantity in and out inside the range, closing as opening + in − out
- [x] 6.2 Return the movements inside the range oldest-first with a running balance per row, paged
- [x] 6.3 Apply product, variant, warehouse and movement-type scoping to both the movement list and the opening/in/out/closing figures, and mark in the response when a type filter is in effect so the UI can state that opening and closing describe the unfiltered position
- [x] 6.4 Wire the CSV variant
- [x] 6.5 Verify against `admin-reporting/stock-reports`: opening + in − out = closing in every case, opening is 0 before the first ever movement, a range with no movements returns equal non-zero opening and closing, the last row's running balance equals closing

## 7. Server — sales report

- [x] 7.1 Implement `GET /reports/sales` summary using `SALES_ORDER_WHERE`: gross sales, discount, shipping, tax, order total, collected, outstanding, refunded, and net
- [x] 7.2 Compute collected from payments in `SETTLED_PAYMENT_STATUSES` only; outstanding as order total minus collected
- [x] 7.3 Attribute refunds to the period of their order, not their own date
- [x] 7.4 Implement the four groupings — day, product, category, payment method — including the explicit unpaid group under the method grouping and a stated attribution rule for multi-category products
- [x] 7.5 Add order status, payment method and guest-order filters; exclude `CANCELLED` from the selectable status set
- [x] 7.6 Wire the CSV variant
- [x] 7.7 Verify against `admin-reporting/sales-reports`: group sums equal report totals for every grouping, order components decompose to order total, and the report's revenue for a 30-day window equals `GET /analytics/dashboard?range=30d`

## 8. Server — purchases report

- [x] 8.1 Implement `GET /reports/purchases`: per purchase order, quantity ordered vs received, purchase value, amount paid, balance owed, and receipt state
- [x] 8.2 Exclude drafts from money figures by default, count and report how many were excluded, and support including them on request; list cancelled purchase orders without counting them
- [x] 8.3 Implement the supplier, status and day groupings, with the supplier grouping ordered by amount owed descending
- [x] 8.4 Add supplier, status and balance-owing filters; mark inactive suppliers rather than omitting their purchase orders
- [x] 8.5 Wire the CSV variant
- [x] 8.6 Verify against `admin-reporting/purchase-reports`: total value − total paid = total owed, subtotal + shipping + tax = purchase value, group sums equal report totals

## 9. Server — payment history report

- [x] 9.1 Implement `GET /reports/payments` as one parameterised `$queryRaw` `UNION ALL` over `Payment` and `SupplierPayment`, with ordering, paging and totals in SQL (design decision 4)
- [x] 9.2 Use `COALESCE(paidAt, createdAt)` as the effective date and return an `isSettled` flag per row (design decision 5)
- [x] 9.3 Project counterparty, document number, method, status and reference on both sides; fall back to the order's recorded name for a guest order, and keep a row whose document no longer exists
- [x] 9.4 Return money in (settled customer payments only), money out, net, pending, and refunded as separate whole-result totals
- [x] 9.5 Add direction, method, status, customer and supplier filters, with the method set constrained to the selected direction
- [x] 9.6 Parse the raw result through a Zod row schema before returning; bind every value through `Prisma.sql` and map sort column and direction from a closed allow-list
- [x] 9.7 Wire the CSV variant
- [x] 9.8 Verify against `admin-reporting/payment-reports`: unsettled amounts excluded from money in and stated as pending, a payment recorded in February and settled in March lands in March, a backdated supplier payment lands on its stated date, totals respect filters

## 10. Admin — supplier payments on the purchase order

- [x] 10.1 Add `admin/src/lib/api/supplier-payments.ts` with list, record, update and delete hooks, plus query keys in `query-keys.ts`
- [x] 10.2 Extend `admin/src/lib/api/purchase-orders.ts` types with `amountPaid`, `balanceDue` and settlement state
- [x] 10.3 Add a Payments card with a **Record payment** dialog to `purchase-order-detail-page.tsx`, mirroring the order detail page's card, showing total / paid / due and the payment list
- [x] 10.4 Hide the record-payment action on draft and cancelled purchase orders
- [x] 10.5 Show settlement state on the purchase orders list and add the balance-owing filter to it

## 11. Admin — reports shell

- [x] 11.1 Add the `Report` section with its five children to `nav-config.ts`, placed between Sales and Marketing, with per-leaf icons as the file's convention requires
- [x] 11.2 Add the five lazy routes to `app-router.tsx`
- [x] 11.3 Add `admin/src/lib/utils/download.ts` — `downloadFile` fetching with `credentials: 'include'`, reading a blob, triggering and revoking an object URL (design decision 8)
- [x] 11.4 Add `admin/src/lib/api/reports.ts` with a hook per report and an export function per report
- [x] 11.5 Build `features/reports/components/report-date-range.tsx` wrapping antd `RangePicker` with presets, converting to and from `YYYY-MM-DD` at its edge (design decision 13)
- [x] 11.6 Build `report-toolbar.tsx` (filters + applied-filter display + clear-all), `report-summary.tsx` (whole-result tiles), and `export-button.tsx` with pending and failure handling
- [x] 11.7 Move the movement type label and colour maps out of `stock-movements-page.tsx` into a shared module and read them from both that page and Stock history
- [x] 11.8 Verify against `admin-reporting/report-shell`: default range is the last 30 days, clearing filters restores defaults, paging and page size never change a summary figure, empty results show an empty state rather than an error, a failed load keeps the range and filters and offers retry

## 12. Admin — the five report pages

- [x] 12.1 Build the Stock report page — no date range, warehouse/search/low-stock/mismatch filters, expandable per-warehouse split, valuation tiles including the unvalued-items disclosure
- [x] 12.2 Build the Sales report page — summary tiles, grouping selector, detail table, status/method/guest filters, and the stated revenue definition on the page
- [x] 12.3 Build the Purchases report page — supplier/status/balance filters, grouping selector, ordered-vs-received and paid-vs-owed columns, drafts-excluded disclosure
- [x] 12.4 Build the Stock history page — product/variant/warehouse/type scoping, the opening → in → out → closing reconciliation banner, and the running-balance movement table
- [x] 12.5 Build the Payment history page — direction/method/status/counterparty filters, in/out/net/pending tiles, visually distinguished directions, and links to the order or purchase order
- [x] 12.6 Confirm the existing Inventory → Stock Movements page is unchanged in address, filters and behaviour

## 13. Postman and verification

- [x] 13.1 Add the four supplier payment endpoints to `server/postman/Ecom.postman_collection.json` under Inventory, including the rejection cases (zero amount, overpayment, draft purchase order)
- [x] 13.2 Add the five report endpoints plus their `format=csv` variants under a new Reports folder
- [x] 13.3 Mirror both additions into `admin/postman/Ecom.postman_collection.json`
- [x] 13.4 Run `pnpm -C server verify:postman` and fix anything it reports
- [x] 13.5 Run `pnpm lint` and `pnpm build` across server and admin
- [x] 13.6 Walk every scenario in the six spec files against the running apps and record any that do not hold
