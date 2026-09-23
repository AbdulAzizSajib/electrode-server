## Why

Fulfilment documents can only be produced one order at a time. A packing session covering a dozen orders means a dozen round trips through order detail → document → print → back, and the operator has to keep their own count of which orders they have already done. The orders list already has multi-select and already hosts one bulk action (courier dispatch), so the selection the operator has made is sitting there unused for the job they most often want it for.

## What Changes

- Add a **Print** action to the orders list bulk bar, offering packing slips, invoices and shipping labels for the current selection — the same three documents the order detail page offers for one order.
- Add a bulk document route that renders the chosen document for every selected order in one view, each on its own sheet, so a single print command produces the whole batch.
- **Cancelled orders are excluded from a print run**, and the view states which were skipped and why. A cancelled order has no parcel; a label for one is waste at best and a mis-shipment at worst.
- Reuse the existing `PackingSlip`, `Invoice` and `ShippingLabel` components unchanged. A document that renders differently in a batch than it does alone would be a second implementation to keep in step.
- Carry over the existing paper-size behaviour: same per-document-type default, same persisted choice, applied to the whole batch rather than per order.

No backend change. The batch fetches each order through the existing `GET /orders/:id` projection the single-document route already uses.

## Capabilities

### New Capabilities
<!-- None. Bulk printing is a new way to reach documents this capability already defines, not a new capability. -->

### Modified Capabilities
- `order-fulfillment-documents`: adds bulk production of the three existing documents from a selection, the rule that cancelled orders are excluded from a batch, and the requirement that one print command yields one sheet per document. The three document-content requirements are unchanged — a batched document is the same document.

## Impact

- **New route**: `/sales/orders/print/:document` in `admin/src/routes/app-router.tsx`, mounted **outside `ShellLayout`** alongside the existing per-order print route, which is what keeps sidebar and topbar off the paper.
- **New components**: a bulk print page, and a `PrintFrame` variant (or a widened `PrintFrame`) that frames many documents rather than one.
- **Modified**: `admin/src/features/sales/orders/orders-list-page.tsx` (bulk bar gains the Print action), `admin/src/features/sales/orders/documents/print-frame.tsx` (page-break rule, multi-document framing), `admin/src/features/sales/orders/documents/print.css`.
- **Selection transport**: the selected ids must reach the print route. They go in the query string; a long selection risks a URL length limit, which `design.md` addresses.
- **Role gating**: the new route needs the same `<RoleGuard>` treatment as the existing print route — `nav-config.ts` is not involved, since neither print route appears in the sidebar.
- **Tests**: `admin/src/features/sales/orders/documents/documents.test.tsx` gains cases for batch composition and cancelled-order exclusion.
