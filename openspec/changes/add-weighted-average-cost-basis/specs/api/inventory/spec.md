## ADDED Requirements

### Requirement: A received purchase order line carries its landed cost

A purchase order's `shippingCost` and `taxAmount` SHALL be allocated across its lines in proportion to each line's value (`quantity × unitCost`) to produce a landed unit cost for every line. A line's landed unit cost SHALL be at least its `unitCost`; the ordered goods' own price is never reduced by the allocation.

When every line on a purchase order has zero value, the allocation SHALL fall back to the bare `unitCost` rather than dividing by zero.

#### Scenario: Shipping and tax are spread across two lines of unequal value

- **WHEN** a purchase order has one line of 10 units at 100 (value 1000) and one line of 10 units at 300 (value 3000), plus 400 shipping and 400 tax
- **THEN** the first line absorbs one quarter of the 800 (200 over 10 units, landed unit cost 120) and the second line absorbs three quarters (600 over 10 units, landed unit cost 360)

#### Scenario: A purchase order carries no shipping or tax

- **WHEN** a purchase order with `shippingCost` 0 and `taxAmount` 0 is received
- **THEN** each line's landed unit cost equals its `unitCost` exactly

### Requirement: Receiving a purchase order updates the cost basis by weighted average

Receiving quantity against a purchase order line SHALL recompute the cost basis of the item received — the `ProductVariant` when the line names a variant, otherwise the `Product` — as the weighted average of the stock already on hand at its existing cost basis and the newly received units at their landed unit cost:

```
newCost = (onHandBefore × existingCost + receivedQuantity × landedUnitCost)
          ÷ (onHandBefore + receivedQuantity)
```

When the item has no existing cost basis, or `onHandBefore` is zero or negative, the new cost basis SHALL be the landed unit cost alone — an unknown or absent prior cost is never treated as zero and averaged in.

The recomputed cost basis SHALL be persisted in the same transaction as the stock increase and the `StockMovement` it accompanies, so a receipt never records stock at a cost the ledger did not also record.

#### Scenario: Receiving at a higher price moves the cost basis part-way

- **WHEN** a product holding 10 units at a cost basis of 90 receives 10 more units at a landed unit cost of 110
- **THEN** its cost basis becomes 100, not 110

#### Scenario: First receipt for a product with no recorded cost

- **WHEN** a product with a null cost basis and no stock on hand receives 5 units at a landed unit cost of 250
- **THEN** its cost basis becomes 250

#### Scenario: A line naming a variant updates that variant, not its product

- **WHEN** a purchase order line for a specific variant is received
- **THEN** that `ProductVariant`'s cost basis is recomputed AND its parent `Product`'s cost basis is left unchanged

#### Scenario: Partial receipt averages only what arrived

- **WHEN** an admin receives 3 of an ordered 10 units
- **THEN** the cost basis is averaged over the 3 units received, and the 7 still outstanding contribute nothing until they are received

### Requirement: A goods receipt is never rejected for pricing the item above its selling price

A receipt that raises an item's cost basis to or above its current `offerPrice` SHALL still succeed. The catalog's price-consistency rule constrains what a merchant may author on the product form and MUST NOT be applied to a purchase receipt — the goods have already arrived, and refusing to record them would leave the stock ledger wrong to protect a price that is merely now unprofitable.

Such a receipt SHALL notify staff that the item is selling at or below cost, so the price can be corrected deliberately.

#### Scenario: Supplier price rises above the product's offer price

- **WHEN** a product selling at an `offerPrice` of 100 receives stock whose landed unit cost lifts its cost basis to 115
- **THEN** the receipt completes, stock increases, the cost basis records 115, and a notification reports that the product now sells below cost
