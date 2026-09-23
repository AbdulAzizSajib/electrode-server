## Why

An order that has been placed currently has no paper trail. Staff can move it through statuses in the admin, but nothing comes out of a printer: the packer has no pick list, the box goes out with no invoice, and the parcel carries no scannable label. Fulfilment is therefore done by reading a screen and hand-writing addresses, which is slow and mis-picks silently.

The two pieces of hardware the merchant already owns — an 80mm thermal receipt printer and a keyboard-wedge barcode scanner — are enough to close this loop entirely, provided the documents are generated in the browser. Nothing about this requires a print server, a PDF service, or a new runtime dependency.

## What Changes

- **New `PACKED` order status**, between `PROCESSING` and `SHIPPED`. Packing is a real, observable fulfilment step that currently collapses into `PROCESSING`; without it "what is packed and waiting for pickup" is unanswerable, and the packing slip has no status to be the artifact of.
- **Three printable documents** rendered in the admin from the existing order detail projection:
  - **Packing slip** — line items, quantity, SKU, variant. The picker's working document. No prices.
  - **Invoice** — priced lines, discount, shipping, tax, total, amount paid and balance due. Goes in the box.
  - **Shipping label** — recipient name, address and phone, plus a **Code 128 barcode encoding `orderNumber`**, with the number printed human-readable beneath it.
- **A hand-written Code 128 encoder** emitting inline SVG. No barcode library is added; the encoder is ~120 lines and covers the Code 128 B character set, which `ORD-YYYYMMDD-XXXXXX` sits inside entirely.
- **Print via `window.print()` and print-only CSS.** Each document has an 80mm thermal stylesheet and an A4 stylesheet selected by `@page`. Packing slip and shipping label default to thermal; the invoice defaults to A4. Either can be switched before printing, and the choice is remembered per document type.
- **Scan-to-open in the admin.** A scanner in keyboard-wedge mode types the order number into the orders list search. When the search resolves to exactly one order, the admin navigates straight to that order's detail page. This reuses the existing list endpoint — `getOrders` already declares `searchableFields: ["orderNumber"]` — so no new backend route is introduced.
- **No new server module.** The only server-side changes are the `PACKED` enum value, its transition rules, and its status-history label.

Not in scope, and deliberately so: product/shelf barcode label printing (a POS and inventory concern, keyed on SKU rather than order), ESC/POS raw command output, and any carrier's own label API. Each is a separate capability, and none is required for the merchant to fulfil an order end to end.

## Capabilities

### New Capabilities
- `order-fulfillment-documents`: printable packing slip, invoice and shipping label for a placed order; Code 128 barcode encoding of the order number; thermal/A4 output selection; scan-to-open order lookup in the admin.

### Modified Capabilities
<!-- No existing spec under openspec/specs/ covers order status; `seo` is the only
     capability with a main spec today. The PACKED status is specified as a
     requirement of the new capability above rather than as a delta against a
     spec that does not exist. -->

## Impact

**Server (`server/`)** — small, and confined to the order module plus one migration:
- `prisma/schema/enums.prisma` — add `PACKED` to `OrderStatus`.
- One migration adding the enum value. **The generated SQL will contain `DROP INDEX` lines for the three `pg_trgm` indexes and they must be deleted, and the NOTE block carried forward**, per the standing rule in `CLAUDE.md`.
- `src/app/module/order/order.service.ts` — `allowedOrderTransitions` gains `PROCESSING → PACKED` and `PACKED → SHIPPED`; `RESTOCKABLE_ON_CANCEL_STATUSES` gains `PACKED` (a packed order's goods are still in the building).
- `src/app/module/order/order.validation.ts` — `updateOrderStatusZodSchema` accepts the new value.
- A `scripts/verify-*.ts` script covering the new transitions, following the existing convention of importing the service directly.

**Admin (`admin/`)** — where the feature lives:
- New `src/features/sales/orders/documents/` holding the three document components, a shared print frame, and the Code 128 encoder.
- `src/features/sales/orders/order-detail-page.tsx` — print actions; `STATUS_LABEL` / `STATUS_VARIANT` gain `PACKED`.
- `src/features/sales/orders/orders-list-page.tsx` — scan-to-open behaviour on the search field.
- `src/lib/api/orders.ts` — `OrderStatus` union gains `PACKED`.
- Vitest coverage for the encoder (the one piece here with a checkable right answer).

**Storefront (`nextjs/`)** — the customer-facing order status timeline and any status label map must render `PACKED` rather than falling through to a blank or unknown state.

**Dependencies** — none added, to any of the three apps. This is a hard constraint of the change, not a preference; see `design.md`.
