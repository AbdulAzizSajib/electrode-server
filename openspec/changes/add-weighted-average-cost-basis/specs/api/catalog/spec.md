## ADDED Requirements

### Requirement: `purchasePrice` is a maintained cost basis, not a fixed authored figure

A product's or variant's `purchasePrice` SHALL represent its cost basis as of now — what the stock currently on hand cost to acquire — rather than a figure fixed at the moment the product was created.

A merchant MAY author it directly, which sets the opening cost for an item that has never been purchased through a purchase order. From the first goods receipt onward, receipts SHALL maintain it, and a later authored value overrides the computed one rather than being merged with it.

Information SHALL flow in one direction only: a purchase receipt writes the cost basis, and the cost basis never writes back into any purchase order. `PurchaseOrderItem.unitCost` remains the immutable record of what a supplier actually charged and SHALL NOT be recalculated when the cost basis moves.

#### Scenario: A merchant sets an opening cost, then receives stock

- **WHEN** a merchant creates a product with a `purchasePrice` of 90 and later receives a purchase order that averages the cost basis to 100
- **THEN** the product's `purchasePrice` reads 100, and the authored 90 is not preserved anywhere on the product

#### Scenario: A past purchase order is unaffected by later cost movement

- **WHEN** an item's cost basis changes after a purchase order for it was received
- **THEN** that purchase order's line `unitCost`, `totalCost`, `subtotal`, and `totalAmount` are all unchanged

### Requirement: The price-consistency rule constrains authoring only

The rule requiring `offerPrice` to exceed `purchasePrice` SHALL be enforced when a product or variant's prices are authored through the catalog, and SHALL NOT be enforced anywhere the cost basis is maintained by a goods receipt.

#### Scenario: A merchant types a losing price on the product form

- **WHEN** a merchant submits a product whose `offerPrice` is at or below its `purchasePrice`
- **THEN** the submission is rejected with an error naming both figures, exactly as before

#### Scenario: A receipt pushes cost above the authored offer price

- **WHEN** a goods receipt raises an item's cost basis above its `offerPrice`
- **THEN** the item is stored in that state and remains sellable, and the next product-form submission for it is rejected until the merchant corrects the price
