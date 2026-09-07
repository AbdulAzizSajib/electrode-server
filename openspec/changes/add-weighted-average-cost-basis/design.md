## Context

See proposal.md — Why.

The constraints that shape the approach, all of them already in the schema:

- `Product.purchasePrice` and `ProductVariant.purchasePrice` are each a single nullable `Decimal(12,2)`. One number per item, no history, no layers.
- `PurchaseOrder.shippingCost` and `taxAmount` live on the header; `PurchaseOrderItem` holds only `unitCost` and `totalCost`. Nothing today connects the two.
- `receivePurchaseOrder` already runs its stock increase, `StockMovement` write and denormalized-total update inside one `prisma.$transaction`, and already calls `StockService.notifyIfLowStock` after it commits. Both are the hooks this change needs.
- `Product.stockQuantity` / `ProductVariant.stockQuantity` are maintained by `StockService.applyDenormalizedStockDelta` as the sum of the ledger across every warehouse, and the storefront already trusts them.
- Checkout loads cart lines with `include: { product: true, variant: true }` — whole rows, so `purchasePrice` is already in hand at order placement with no extra query.

## Goals / Non-Goals

**Goals:**

- One cost number per item that means "what the stock on hand cost", maintained by receipts rather than by memory.
- Cost that includes what it actually took to land the goods, not just the invoice line.
- A per-order record of cost at the moment of sale, so any later profit figure is reproducible.
- Pure, dependency-free arithmetic that can be unit-tested without a database.

**Non-Goals:**

- FIFO or specific-identification costing, and the cost-layer table either would require.
- A profit or COGS report. This change only makes one possible.
- Per-warehouse costing. Cost basis stays a property of the item, as `purchasePrice` already is.
- Revaluing stock already on hand when a receipt moves the average. Weighted average revalues by definition; nothing separate is written.

## Decisions

### 1. Weighted average (AVCO), not FIFO

IAS 2 — which BAS 2 adopts — permits FIFO and weighted average and prohibits LIFO, so the real choice is between the first two. FIFO requires a cost layer per receipt with a remaining quantity, consumed in order on every sale and unwound on every return. The schema has one `Decimal` per item, which is the shape of an average, not of a layer set. Adopting FIFO means a new model and a write on every sale; adopting AVCO means one update on receipt.

*Alternatives:* FIFO (rejected — new model, touches every sale path, far past "lean"). Last-cost (rejected — not permitted as an inventory valuation basis under IAS 2, and it discards the cost of stock still on hand the moment one unit arrives at a new price).

### 2. Reuse `purchasePrice` as the cost basis; do not add a `costBasis` column

The two readers that matter — `report.stock.ts` valuation and the catalog margin guard — already read `purchasePrice`. Writing the average into a second column would leave those readers on the stale one, which is the exact bug this change exists to close, only harder to see.

The consequence, recorded in the catalog spec: a merchant-authored `purchasePrice` is an *opening* cost for an item never purchased through a PO, and receipts overwrite it from then on. That is the trade — the authored figure is not preserved.

*Alternative:* a new `costBasis` column with `purchasePrice` left as the authored figure. Rejected: two cost fields is the drift problem restated.

### 3. Allocate shipping and tax pro-rata by line value; capitalize input VAT

IAS 2 puts transport, handling, and non-recoverable duties into inventory cost. Allocation is by line value (`quantity × unitCost`), not by quantity or by line count.

```
lineValue_i   = quantity_i × unitCost_i
allocatable   = shippingCost + taxAmount
landedTotal_i = lineValue_i + allocatable × (lineValue_i ÷ Σ lineValue)
landedUnit_i  = round2(landedTotal_i ÷ quantity_i)
```

Input VAT is capitalized — treated as non-recoverable. This is the conservative direction: capitalizing tax the merchant could have reclaimed overstates cost and makes the margin guard stricter, whereas excluding tax the merchant cannot reclaim understates cost and reports a loss-making product as profitable. Only the second error is dangerous. A VAT-registered merchant would want it excluded; that becomes a `StoreSetting` flag in a later change, at which point the allocation gains a branch and this spec gains a condition.

*Alternatives:* allocate by quantity (rejected — a cheap bulky line and an expensive small line would absorb the same freight per unit, misstating both). Allocate nothing and use bare `unitCost` (rejected — makes the margin guard permanently optimistic, and is not what IAS 2 permits). Exclude tax unconditionally (rejected — see above).

### 4. Read `onHandBefore` from the denormalized total, inside the transaction, before the increment

```
newCost = (onHandBefore × existingCost + receivedQty × landedUnit)
          ÷ (onHandBefore + receivedQty)
```

`onHandBefore` is `ProductVariant.stockQuantity` when the line names a variant, otherwise `Product.stockQuantity`, read inside the receipt transaction and **before** `applyDenormalizedStockDelta` runs for that line. Ordering is load-bearing: reading after the increment gives a denominator that already contains the received units and a numerator that does not, silently under-weighting the new cost.

`existingCost == null || onHandBefore <= 0` → `newCost = landedUnit`. A null cost is not zero, and averaging it in as zero would halve the basis on the first receipt.

*Alternative:* sum `Stock.quantity` across warehouses per line. Same number by construction (that is what the denormalized column is), one extra query per line.

### 5. Pure arithmetic in its own module; only the write-back touches the transaction

`purchase-order.cost.ts` exports `allocateLandedUnitCosts(order)` and `weightedAverageCost(onHandBefore, existingCost, receivedQty, landedUnit)` — no Prisma, no I/O. `receivePurchaseOrder` calls them and issues the update; `order.service.ts` only reads a field it already has loaded.

This is what makes the "minimal tests" instruction cheap to honor: the arithmetic that can actually be wrong is testable with plain function calls, so the two endpoint tests do not have to carry it.

### 6. `OrderItem.unitCost` is nullable and never backfilled

Existing order rows were placed when no cost was recorded; any backfill would be today's cost stamped on last year's sale. Null says "unknown", which is the truth, and lets a future profit report exclude those rows rather than quietly averaging in a fabricated margin.

Nullable also covers the live case in the checkout spec: an item whose cost basis was never set sells normally and records null.

### 7. The margin guard needs no code change — only a notification

`addPriceConsistencyIssues` lives in `product.validation.ts` and is wired only into the product write schemas. The receipt path never calls it, so scoping it to authoring is already true; the catalog spec states it so it stays true. What is new is the notification when a receipt lifts cost to or above `offerPrice`, emitted after commit alongside the existing `notifyIfLowStock` call.

## Risks / Trade-offs

- **A merchant's authored `purchasePrice` is overwritten by the first receipt** → Intended and specified (Decision 2), but it will surprise someone. The admin product form should eventually label the field as maintained by purchases; out of scope here, noted for the admin repo.
- **Cost basis is item-level while stock is warehouse-level** → Accepted. `purchasePrice` is already item-level and the stock report already values every warehouse with it; this change does not widen that gap.
- **Averaging inherits any error in `Product.stockQuantity`** → Accepted. It is the same column the storefront already derives `inStock` from, so an error there is already visible and already a bug.
- **Stock adjustments and returns do not touch the cost basis** → Units added by an adjustment are implicitly valued at the current basis, which is the standard treatment for a quantity change carrying no cost of its own. Returns of sold goods likewise. Left alone deliberately; revisit if adjustments start carrying a cost.
- **Rounding each landed unit cost to 2 dp drifts slightly over many receipts** → Accepted at `Decimal(12,2)`. The allocated amounts are not persisted as a reconciling total; only the derived cost basis is stored, so there is no ledger for the residue to break.
- **`unitCost` leaking to a customer** → It is supplier cost. The checkout spec forbids it on customer-facing responses; the order projections must be checked, not assumed, when the field is added.

## Migration Plan

1. Additive migration: `OrderItem.unitCost Decimal? @db.Decimal(12,2)`. Nullable, no default, no backfill — safe on a live table.
2. Deploy. Cost basis begins moving on the next receipt; orders begin recording cost on the next placement.
3. No data migration for `purchasePrice` — existing values stand as the opening cost for each item.

**Rollback:** revert the code and drop the column. Cost-basis values already written into `purchasePrice` remain and stay valid — they are simply no longer maintained, which is the state before this change.
