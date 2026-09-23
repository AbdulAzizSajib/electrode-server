## 1. Server: the PACKED status

- [x] 1.1 Add `PACKED` to the `OrderStatus` enum in `server/prisma/schema/enums.prisma`, positioned between `PROCESSING` and `SHIPPED`; verify `pnpm --filter ./server exec prisma generate` succeeds and the generated client exports the new member
- [x] 1.2 Generate the migration with `pnpm --filter ./server migrate`, then **open the generated SQL and delete the three `DROP INDEX` lines** for `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx`, and copy the NOTE block forward from the most recent existing migration; verify by grepping the new migration file for `DROP INDEX` and getting no hits
- [x] 1.3 Confirm the migration applies cleanly given that PostgreSQL forbids `ALTER TYPE ... ADD VALUE` inside a transaction block (design.md Decision 6); verify by running the migration against the shadow database and, if Prisma's generated form fails, hand-author the statement so it runs outside the transaction
- [x] 1.4 Extend `allowedOrderTransitions` in `server/src/app/module/order/order.service.ts` with `PROCESSING → PACKED` and `PACKED → SHIPPED | CANCELLED`; verify the map compiles and no other transition gained or lost a target
- [x] 1.5 Add `PACKED` to `RESTOCKABLE_ON_CANCEL_STATUSES` in the same file, with a comment stating why (a packed parcel has not left the premises); verify cancelling a `PACKED` order credits stock back
- [x] 1.6 Accept `PACKED` in `updateOrderStatusZodSchema` in `server/src/app/module/order/order.validation.ts`; verify a `PATCH /orders/:id/status` carrying `PACKED` is no longer rejected by validation
- [x] 1.7 Write `server/scripts/verify-order-packed-status.ts` following the existing verify-script convention — import `OrderService` directly, create `__verify_`-prefixed rows, clean up in a `finally`; verify with `npx tsx scripts/verify-order-packed-status.ts` that `PROCESSING → PACKED → SHIPPED` is accepted, that `PENDING → PACKED` and `CONFIRMED → PACKED` are rejected, and that cancelling from `PACKED` restocks

## 2. Storefront: render the new status

- [x] 2.1 Add `"PACKED"` to the `OrderStatus` union in `nextjs/src/types/order.ts`; verify `pnpm --filter ./nextjs build` type-checks and that the three `.toLowerCase()` render sites (`track-order/page.tsx:30`, `checkout/success/page.tsx:80`, `GuestOrderConfirmation.tsx:140`) show "packed" for such an order

## 3. Admin: Code 128 encoder

- [x] 3.1 Write the Code 128 B encoder at `admin/src/features/sales/orders/documents/code128.ts` — pattern table, start code, modulo-103 checksum, stop code — returning bar/space run lengths and returning `null` for any string containing an unencodable character; verify it is a pure function taking a string and touching no DOM or network
- [x] 3.2 Write `code128.test.ts` asserting exact bit patterns for known vectors including the checksum, a real `ORD-20260908-A1B2C3` order number end to end, and `null` for an unencodable input; verify `pnpm --filter ./admin test` passes (a wrong barcode still looks like a barcode, so these tests are the only real check — see design.md Decision 1)
- [x] 3.3 Write the SVG renderer component that turns encoder output into inline `<svg>` with one `<rect>` per bar, and renders the human-readable order number beneath; verify it emits no `<canvas>` and no external fetch, and that omitting the barcode (encoder returned `null`) still renders the text

## 4. Admin: print frame and paper size

- [x] 4.1 Create the shared print frame at `admin/src/features/sales/orders/documents/print-frame.tsx` — renders a document outside the app shell, with a size toggle and a print button; verify the printed output contains no sidebar, navigation or buttons
- [x] 4.2 Write the thermal and A4 stylesheets using `@page { size: 80mm auto }` and `@page { size: A4 }`, with 72mm print width inside 80mm paper, no background colours or shading anywhere, and ~9pt minimum body size; verify by printing to PDF at both sizes that nothing clips horizontally
- [x] 4.3 Persist the paper-size choice per document type in `localStorage` with packing slip and label defaulting to thermal and invoice to A4 (design.md Decision 4); verify switching the invoice to thermal and reopening the invoice for a different order keeps thermal
- [x] 4.4 Register the print routes `/orders/:orderId/print/:document` in `admin/src/routes/app-router.tsx` behind the existing staff `RoleGuard`; verify a customer-role session is refused, and note these are intentionally **not** added to `nav-config.ts` since they are reached from an order, not the sidebar

## 5. Admin: the three documents

- [x] 5.1 Build the packing slip component — order number, date, recipient, and per-line product name, variant, SKU and quantity; verify no unit price, line total, order total or `unitCost` appears anywhere in the rendered output
- [x] 5.2 Build the invoice component — store identity from `useStoreSettings`, order number and date, recipient address, per-line quantity/unit price/line total, then subtotal, discount, shipping, tax and total; verify the totals equal the order's own columns
- [x] 5.3 Add paid and balance-due figures to the invoice, derived from `usePaymentsByOrder` the same way `order-detail-page.tsx` already computes `paidTotal` and `balanceDue`; verify an unpaid 1200 order shows 1200 due, and a 1200 order with 500 paid shows 500 paid and 700 due
- [x] 5.4 Format every invoice money value through the store's `currencySymbol` and `currencyDecimals`; verify a store configured to 0 decimals renders no decimal places
- [x] 5.5 Build the shipping label component — recipient name, address and phone, store return identity, and the barcode from task 3.3; verify an order with no shipping address renders a collection notice rather than an empty address block
- [x] 5.6 Apply `break-inside: avoid` to item rows so a long packing slip splits between pages cleanly; verify by printing a 30-line order to PDF that no row is cut in half

## 6. Admin: wire into the order workflow

- [x] 6.1 Add `PACKED` to `STATUS_LABEL` and `STATUS_VARIANT` in `admin/src/features/sales/orders/order-detail-page.tsx` and to the `OrderStatus` union in `admin/src/lib/api/orders.ts`; verify `pnpm --filter ./admin build` type-checks (these `Record<OrderStatus, ...>` maps fail at compile time when a case is missing)
- [x] 6.2 Add print actions for the three documents to the order detail page; verify each opens its print route for the order in view
- [x] 6.3 Implement scan-to-open on `orders-list-page.tsx`: navigate to the order detail view when a search resolves to **exactly one** result, and render the list unchanged for zero or many (design.md Decision 5 — `searchTerm` is a substring match, so navigating on the first of several would open the wrong order); verify all three cases
- [x] 6.4 Auto-focus the orders-list search field on mount so a scan needs no click first; verify scanning immediately after the page loads populates the field

## 7. Verification on real hardware

- [ ] 7.1 Print a shipping label to the 80mm thermal printer and **scan it with the merchant's barcode gun**; verify the scanner reports exactly the order number shown beneath the barcode, with no prefix, suffix or case change — visual inspection is explicitly not sufficient here
- [ ] 7.2 Print all three documents at both paper sizes and confirm nothing clips, no shading renders as a black block, and text is legible at ~9pt
- [ ] 7.3 Walk one order end to end — place it, move it `PROCESSING → PACKED`, print slip/invoice/label, scan the label to reopen it, then move it to `SHIPPED`; verify each step and that the storefront shows "packed" while it is in that state
- [ ] 7.4 Confirm a fulfilment document prints with the machine disconnected from the internet; verify the barcode still renders (the encoder must contact nothing)
- [x] 7.5 Run `pnpm --filter ./server lint`, `pnpm --filter ./admin lint`, `pnpm --filter ./admin test` and `pnpm build`; verify all pass
