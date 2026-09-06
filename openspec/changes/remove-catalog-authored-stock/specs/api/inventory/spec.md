## MODIFIED Requirements

### Requirement: Stock changes are always logged as a StockMovement
Any change to `Stock.quantity` SHALL be accompanied by a `StockMovement` row recording the type (purchase, sale, return, adjustment, etc.) and quantity delta — `Stock` is never edited directly without a corresponding audit trail entry.

The `Stock` ledger SHALL be the only writer of stock. No capability outside inventory — the catalog in particular — SHALL change a stock quantity, so every unit a product reports can be traced to the movement that put it there.

#### Scenario: Admin manually adjusts stock
- **WHEN** an admin corrects a warehouse's stock count for a product
- **THEN** `Stock.quantity` changes AND a `StockMovement` with `type: ADJUSTMENT` is created recording the delta and an optional note

#### Scenario: Stock cannot be changed from outside the inventory capability
- **WHEN** any request outside the inventory capability attempts to set a product's or variant's stock quantity
- **THEN** the stored quantities are unchanged
- **AND** no `Stock` row and no `StockMovement` is created

## ADDED Requirements

### Requirement: Denormalized stock totals mirror the ledger
`Product.stockQuantity` and `ProductVariant.stockQuantity` are denormalized totals of the `Stock` ledger, maintained so a total can be read and sorted on without aggregating warehouse rows. They SHALL NOT be authored independently of the ledger.

`ProductVariant.stockQuantity` SHALL equal the stock held for that variant across all warehouses. `Product.stockQuantity` SHALL equal the stock held for that product across all warehouses **including stock held against its variants** — a product's total is everything held for it, not only what is held against no variant.

Every path that changes `Stock.quantity` SHALL apply the same delta to both affected totals in the same transaction, so a variant movement updates the variant's total and its product's total together.

#### Scenario: Receiving stock against a variant updates both totals
- **WHEN** stock is received against a specific variant of a product
- **THEN** that variant's total increases by the received quantity
- **AND** the product's own total increases by the same quantity

#### Scenario: Selling a variant lowers both totals
- **WHEN** an order deducts stock for a line naming a variant
- **THEN** that variant's total decreases by the ordered quantity
- **AND** the product's own total decreases by the same quantity

#### Scenario: A variable product reports a total across its variants
- **WHEN** a product's stock is held entirely against its variants
- **THEN** the product's own total equals the sum of the stock held for those variants
- **AND** a storefront reading only the product's total sees it as in stock

#### Scenario: Stock held against no variant is still the product's stock
- **WHEN** stock is received for a product without naming a variant, including for a product that has variants
- **THEN** the product's total increases by the received quantity
- **AND** no variant's total changes, because none received the stock

#### Scenario: Totals can be reconciled against the ledger
- **WHEN** a denormalized total is found to disagree with the stock the ledger holds for it
- **THEN** the total can be reset to the ledger's sum without creating a `StockMovement`, because no stock moved
