## Why

`Product.purchasePrice` is authored once on the product form and never moves again, while `PurchaseOrderItem.unitCost` records what a supplier actually charged on each purchase. Nothing connects them, so the two drift apart the moment a supplier changes their price — and two features silently read the stale one: the stock report values inventory at `onHand × purchasePrice`, and the catalog's margin guard rejects a sale "at a loss" by comparing `offerPrice` against a cost that may be a year old. A merchant who buys at 105 while the product still says 90 is told their 100 offer price is profitable.

The fix is the standard one: make the purchase order the source of cost truth and let it write the cost basis forward. That in turn forces a second gap into the open — `OrderItem` records what was charged but not what it cost, so once `purchasePrice` starts moving, no profit figure computed after the fact can ever be reproduced.

## What Changes

- **Landed cost per receipt line.** A purchase order's `shippingCost` and `taxAmount` are header-level today and excluded from `unitCost` entirely. They are now allocated across the order's lines pro-rata by line value, so each received unit carries its true landed cost. (Assumption, recorded in design: input VAT is treated as non-recoverable and therefore capitalized into cost. A merchant who claims VAT rebate would want it excluded; that becomes a store setting in a later change.)
- **Weighted-average cost write-back on receipt.** Receiving a purchase order recomputes the cost basis of each received product — or variant, when the line names one — as a moving weighted average of the stock already on hand and the newly received units at their landed cost.
- **Cost snapshot on sale.** `OrderItem` gains `unitCost`, copied from the product/variant cost basis at the moment the order is placed, alongside the `unitPrice` it already snapshots.
- **The margin guard becomes write-time only.** `offerPrice > purchasePrice` continues to reject a product form submission, but SHALL NOT block a goods receipt that pushes cost above the current offer price. The receipt succeeds and notifies instead, the way low-stock already does.
- Not in scope: FIFO cost layers, a profit/COGS report built on the new snapshot, revaluation of historical `OrderItem` rows, and the admin purchase-order form prefilling `unitCost` from the current cost basis (an admin-repo concern).

## Capabilities

### New Capabilities

None. This change adds behavior to three existing capabilities rather than introducing a new surface.

### Modified Capabilities

- `api/inventory`: receiving a purchase order additionally recomputes the received item's cost basis by weighted average over landed cost, and never fails because the result exceeds the selling price.
- `api/checkout`: the order snapshot now covers unit cost as well as unit price, so a placed order's margin is fixed at placement and unaffected by later receipts.
- `api/catalog`: `purchasePrice` is redefined from a purely authored field to a cost basis that goods receipts maintain; the price-consistency rule is scoped to authoring.

## Impact

- **Schema / migration**: `OrderItem.unitCost` added as a nullable `Decimal(12,2)` — nullable so existing order rows, whose cost at sale is unknowable, stay honest rather than being backfilled with a fabricated number. No other column changes; `Product.purchasePrice` and `ProductVariant.purchasePrice` keep their shape and gain a writer.
- **Server code**: `purchase-order.service.ts` (receipt transaction), `order.service.ts` (order item creation), `product.validation.ts` (guard scoping), and a new cost-basis helper shared between them.
- **Reads that change meaning without changing code**: the stock report's `costValue` / `totalCostValue` (`report.stock.ts`) begin tracking actual purchases; `unvaluedItemCount` shrinks as receipts land on products that had no purchase price.
- **Admin/API surface**: no endpoint signature changes. `OrderItem.unitCost` appears on admin order projections; it is supplier cost and MUST NOT be exposed on any customer-facing order response.
- **Out of repo**: the admin app's purchase-order form still defaults `unitCost` to `0`; prefilling it from the cost basis is a follow-up in the admin repo.
