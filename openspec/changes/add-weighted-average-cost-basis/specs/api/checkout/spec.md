## MODIFIED Requirements

### Requirement: Placing an order snapshots cart contents into immutable order data
Checkout SHALL create an `Order` with `OrderItem` rows that copy the product name, SKU, unit price, and unit cost at the moment of purchase, independent of later catalog changes.

`OrderItem.unitCost` SHALL be the cost basis of the item sold — the `ProductVariant`'s when the line names a variant that has one, otherwise the `Product`'s — read at order placement. It is a snapshot on the same footing as `unitPrice`: once written it is never recalculated, so the margin on a placed order is fixed at placement and unaffected by any later purchase receipt that moves the cost basis.

When the item sold has no cost basis recorded, `OrderItem.unitCost` SHALL be null rather than zero. A missing cost is not a cost of nothing, and any figure derived from it must be able to tell the difference.

`OrderItem.unitCost` is supplier cost and MUST NOT appear in any customer-facing order response.

#### Scenario: Product price changes after an order is placed
- **WHEN** a product's price changes after an order containing it was placed
- **THEN** the existing `OrderItem.unitPrice` on that order is unaffected

#### Scenario: A purchase receipt moves the cost basis after an order is placed
- **WHEN** a purchase order is received for a product that an earlier order already sold, changing that product's cost basis
- **THEN** the existing `OrderItem.unitCost` on that earlier order is unaffected

#### Scenario: A product with no recorded purchase cost is ordered
- **WHEN** a customer orders a product whose cost basis has never been set
- **THEN** the order is created normally and its `OrderItem.unitCost` is null

#### Scenario: A customer reads back their own order
- **WHEN** a customer fetches an order they placed
- **THEN** the response carries `unitPrice` for each item and omits `unitCost` entirely
