## Why

An admin action that cannot be corrected from the admin panel is a support ticket that ends in someone running SQL against production. This change closes the cases where that is true today.

The pattern was found while fixing one instance of it: a purchase order line could be created without a `variantId`, the received stock landed on a `variantId: null` `Stock` row, and because customer orders deduct against the variant actually bought, that stock could never be sold — the product read "out of stock" however much had arrived. Nothing errored at any point. The fix required both a guard (the admin form now refuses a variable product's line with no variant) and, separately, a repair path for the rows already written (`PATCH /stock/:id/reassign-variant`). The guard alone would have left existing merchants stuck.

An audit of the remaining modules found seven more of the same shape, verified against the code. They fall into three groups:

1. **A write with no reverse.** Cancelling an order deducts stock that is never returned; redeeming a coupon increments a counter that no endpoint can decrement; a refund, once recorded, cannot be voided.
2. **A guard that protects a mistake instead of the data.** A purchase order is frozen from its first partial receipt, with no way to amend a line — and its now-frozen `totalAmount` permanently caps what can be recorded as paid to the supplier.
3. **A missing transition guard that lets the same effect happen twice.** A completed return can be moved back to `APPROVED` and re-completed, restocking the same physical goods a second time.

Group 3 is the most alarming: the admin UI actively guides the operator into it, via a "Set status" dialog that offers every status with no forward-only constraint.

## What Changes

Two kinds of work, deliberately kept distinct. **Guards** stop new bad data. **Correction paths** repair what already exists. A guard without a correction path leaves current data stranded, which is the mistake the archetype nearly repeated.

### Correction paths (new endpoints)

- **Restock a cancelled order.** `updateOrderStatus`/`cancelOwnOrder` currently write only the status and a history row (`order.service.ts:1276-1315`). A cancellation before fulfilment returns the goods to the ledger, writing a `StockMovement` so the reason is recorded as a cancellation rather than a manual `ADJUSTMENT` — an admin correcting this by hand today permanently misreports a cancelled sale as an inventory gain.
- **Void or amend a refund.** `RefundService` exposes only `createRefund` and `getRefunds` (`refund.route.ts:10-21`); the admin client documents the absence as deliberate (`admin/src/lib/api/refunds.ts:3-5`). A mistyped amount is currently permanent, and a second corrective refund is impossible because the amount must be positive. Voiding also has to unwind what creation did — the `ReturnRequest` it force-completed and the `Payment.status`/`totalSold` it moved.
- **Correct a coupon's `usageCount`.** Incremented at `order.service.ts:959` and written nowhere else; it appears in neither the create nor the update schema, so no admin endpoint can touch it. Cancelled orders permanently consume the global allowance while *freeing* the per-customer one, because the two limits are computed differently (`coupon.service.ts:190` vs `:194-201`). Where practical, prefer deriving usage from live redemptions over storing a counter that can drift — the settlement figures on purchase orders already take this approach (`purchase-order.service.ts:37-53`).
- **Amend purchase order lines after a partial receipt.** Editing is refused outright from the first receipt (`purchase-order.service.ts:236-244`), and line items appear in no update schema at all, so quantity and unit cost are write-once from creation. Allow amending the not-yet-received portion of a line; received quantities stay immutable, because a receipt established a cost basis.

### Guards (stop the new bad data)

- **Return status transitions become forward-only.** `updateReturnStatus` validates no transition at all; the restock guard is only `existing.status !== COMPLETED` (`return.service.ts:212`), so `COMPLETED → APPROVED → COMPLETED` restocks twice and the phantom units become real stock the storefront will sell. Constrain the transitions server-side, and stop the admin's "Set status" dialog from offering every status unconditionally (`admin/.../return-detail-page.tsx:99-105`).
- **Reconcile the two paths to `COMPLETED`.** Issuing a refund force-completes the `ReturnRequest` (`refund.service.ts:52-57`), bypassing the warehouse requirement that `updateReturnStatus` enforces (`return.service.ts:204-210`) — so one path restocks and the other silently does not. They must agree.
- **Order status transitions become constrained.** `updateOrderStatus` validates only that the status is actually changing (`order.service.ts:1288`), so `CANCELLED → DELIVERED` is accepted. That matters most now that cancelling restocks: a transition that could not happen physically produces stock side effects nothing can reconcile.

  *Corrected during implementation:* this bullet originally also claimed that an admin correcting a payment status double-counts `totalSold`. It does not — both paths were already guarded. See tasks.md 3.2 for the verification; the consolidation shipped anyway as hardening.
- **Shipment timestamps become clearable.** `shippedAt`/`deliveredAt` are `.optional()` but not `.nullable()` (`shipment.validation.ts:20-26`), and the service maps falsy to `undefined` (`shipment.service.ts:71-80`), which Prisma reads as "leave alone". A wrongly-stamped delivery date is permanent.

### Making the problem visible

Guards and repair endpoints are worth nothing if nobody knows to use them. Each condition above that can already exist in live data needs an admin-visible signal, following the pattern just built for stranded stock: the Stock page flags each unsellable row "No variant", explains in a banner why the product reads out of stock, and offers "Fix variant" on the row itself.

## Capabilities

### Modified Capabilities

- `api/checkout`: cancelling an order restocks it; order status transitions are constrained; a coupon's usage count is correctable or derived.
- `api/post-purchase`: refunds can be voided or amended; return status transitions are forward-only; the refund and return paths to `COMPLETED` agree about restocking; shipment timestamps can be cleared.
- `api/inventory`: a purchase order's unreceived line quantities can be amended after a partial receipt.

## Impact

- **Affected code**: `order.service.ts` (restock on cancel, transition guard), `refund.service.ts` + `refund.route.ts`/`refund.validation.ts` (void/amend), `coupon.service.ts` (usage correction), `return.service.ts` (transition guard, reconcile with refund), `shipment.service.ts`/`shipment.validation.ts` (nullable timestamps), `purchase-order.service.ts` (line amendment); admin screens for orders, returns, refunds, coupons and purchase orders.
- **Data already affected**: each correction path needs a way to find existing bad rows. `scripts/report-variantless-stock.ts` is the model — read-only, names the affected records, and points at the admin screen that fixes them.
- **Sequencing**: the three capability areas are independent. Within each, the guard and its correction path should ship together — a guard alone strands existing data, and a correction path alone lets the same mistake recur.
- **Not covered**: the append-only `StockMovement` ledger stays append-only; corrections write compensating entries rather than editing history. `Warehouse` deletion after stock movements exist stays blocked, since `isActive` already provides the deactivate path (`warehouse.service.ts:84-92`).
