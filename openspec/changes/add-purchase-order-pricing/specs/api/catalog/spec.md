## ADDED Requirements

### Requirement: A goods receipt is an authorised writer of selling prices

A product's or variant's `offerPrice` and `sellingPrice` SHALL be writable by two paths: a merchant authoring them through the catalog, and a goods receipt applying prices staged on the purchase order line that delivered the stock.

A receipt SHALL write only the prices staged on the line it is receiving, SHALL leave every other field of the product untouched, and SHALL record the write on the same audit entry as the receipt's other effects, so that a price which changed without a product edit is still attributable.

No other path SHALL write these prices. In particular, the cost basis moving SHALL NOT cause a selling price to change on its own.

#### Scenario: A receipt writes only what was staged

- **WHEN** a receipt applies a staged offer price to a product
- **THEN** that product's offer price changes, its regular price and every non-price field are unchanged, and the change is attributable to the receipt

#### Scenario: Cost movement alone changes no selling price

- **WHEN** a receipt raises an item's cost basis and the line stages no prices
- **THEN** the item's `offerPrice` and `sellingPrice` are unchanged

### Requirement: The loss guard is not applied to a price a receipt writes

The rule requiring `offerPrice` to exceed `purchasePrice` SHALL be enforced when prices are authored through the catalog, and SHALL NOT be enforced on a selling price applied by a goods receipt from a purchase order line's staged value.

Such a price is applied as part of recording goods that have physically arrived, and the same reasoning that forbids rejecting a receipt over the cost it computes forbids rejecting it over the price staged alongside. The receipt SHALL instead notify staff that the item sells at or below cost, and the item SHALL remain in that state, sellable, until a merchant corrects it — at which point the catalog's own rule applies again and refuses a losing price.

#### Scenario: A merchant types a losing price on the product form

- **WHEN** a merchant submits a product whose `offerPrice` is at or below its `purchasePrice`
- **THEN** the submission is rejected with an error naming both figures, exactly as before

#### Scenario: A receipt applies a staged price that is below the new cost

- **WHEN** a goods receipt applies a staged `offerPrice` that is at or below the cost basis the same receipt computes
- **THEN** the receipt completes, the staged price is stored, staff are notified that the item sells below cost, and the item remains sellable

#### Scenario: Correcting it afterwards is guarded again

- **WHEN** a merchant edits a product left selling below cost by a receipt and submits a price still at or below its cost basis
- **THEN** the submission is rejected, as any authored losing price is

### Requirement: The catalog is never copied back onto a purchase order

A purchase order line MAY report an item's current prices for the merchant's information. That SHALL be a read at request time and SHALL NOT store a copy of any catalog price on the line.

A purchase order line's `unitCost` and `totalCost` SHALL remain the immutable record of what a supplier charged, and SHALL NOT be recalculated when a product's cost basis or selling prices move. A line's staged prices SHALL likewise be unaffected by a later product edit, and SHALL NOT be re-applied because of one.

#### Scenario: A product price change does not disturb a past order

- **WHEN** a merchant changes a product's offer price after a purchase order for it was received
- **THEN** that order's line `unitCost`, `totalCost` and staged prices are unchanged, and nothing is re-applied

#### Scenario: Reported prices are read, not stored

- **WHEN** a purchase order line reports an item's current prices and the item's prices then change
- **THEN** the line reports the new figures on the next read, having stored neither the old nor the new
