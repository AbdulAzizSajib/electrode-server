## Why

Handing parcels to a courier is currently a one-order-at-a-time job. A merchant with fifty orders to dispatch opens fifty order pages and fills in fifty shipment dialogs, and the carrier on each is a free-text box (`placeholder="e.g. UPS"`) — so "Pathao", "pathao" and "Pathao Courier" all land in the same column as different values. That has two costs: the dispatch itself is slow, and once the data is written this way no per-courier question ("how many parcels did Steadfast take last week", "which courier loses the most") can be answered without cleaning it up by hand first.

The related gap is at handover. Nothing produces the list a merchant gives the courier's rider to sign against, so what actually left the building each day is recorded nowhere.

## What Changes

- Introduce **couriers as records** rather than as text typed into a shipment. A courier has a name, contact details, coverage note and an active flag, and is managed from the admin like any other resource.
- **Shipment carrier becomes a courier reference.** The order detail shipment dialog picks a courier from a list instead of accepting free text. Existing free-text values are preserved and remain visible — see `design.md`.
- **Bulk assign**: select orders on the orders list, choose one courier, and create or update all their shipments in one action, advancing the orders' status in the same step.
- **Bulk shipping-label print**: print the labels for a selection of orders as one print job, reusing the existing label document.
- **Courier manifest**: a printable handover sheet listing the parcels going to one courier, with a signature area, produced from a selection or from a courier's pending consignment.

Not in this change, deliberately: scanning a barcode to advance an order's status from the order or assign screen. It is a real gap — an operator today must return to the orders list and click into the search box before each scan — but it is a distinct interaction problem, and folding it in would couple two unrelated designs. It gets its own proposal.

No breaking changes to the storefront. `Shipment.carrier` is widened in place rather than replaced, so existing rows keep rendering.

## Capabilities

### New Capabilities

- `courier-management`: What a courier record is, who may manage one, and the rules governing deactivation and deletion when shipments already reference it.
- `courier-dispatch`: Assigning orders to a courier in bulk, the printable handover manifest, and the batched shipping-label print job.

### Modified Capabilities

- `order-fulfillment-documents`: The shipping label and its batch-print behaviour gain a requirement covering multi-order print jobs; the capability's existing single-document requirements are unchanged.

## Impact

**Backend (`server/`)**
- New `Courier` Prisma model + migration. The migration must have its `DROP INDEX` lines removed and the trigram NOTE block carried forward — see the repo's migration warning.
- `Shipment` gains an optional `courierId` relation alongside the existing `carrier` string.
- New `courier` module (route/controller/service/validation/interface) mounted in `src/app/routes/index.ts`.
- Shipment service gains a bulk assign path; order status transitions are reused, not duplicated.
- Verify scripts under `scripts/verify-*.ts` for the new service paths.

**Admin (`admin/`)**
- New Couriers resource (list + form) registered in both `nav-config.ts` and `app-router.tsx`.
- Orders list gains row selection and a bulk action bar.
- Shipment dialog's carrier field becomes a courier select.
- New manifest document beside the existing `documents/` set.

**Storefront (`nextjs/`)**
- None. Courier identity is internal; the customer-facing order timeline already shows status only.
