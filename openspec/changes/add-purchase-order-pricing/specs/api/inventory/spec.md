## ADDED Requirements

### Requirement: A purchase order line reports the ordered item's current prices

A purchase order line SHALL make available, for the item it names, the three prices the catalog holds for it: its cost basis (`purchasePrice`), its `offerPrice`, and its `sellingPrice`. Where the line names a variant, the variant's own price SHALL be reported in preference to its parent product's for each of the three, falling back to the parent where the variant does not set one — the same precedence a goods receipt uses when it values that line.

These figures SHALL be the item's prices as of the read, not a snapshot taken when the line was created. They are reported for the merchant's information while costing the order and SHALL NOT alter the line's `unitCost`, `totalCost`, or any order total.

#### Scenario: A line for a simple product

- **WHEN** a purchase order line names a product with a cost basis of 90, an offer price of 150 and a regular price of 180
- **THEN** the line reports 90, 150 and 180 for that item

#### Scenario: A line for a variant that prices itself

- **WHEN** a line names a variant with its own offer price of 200, whose parent product's offer price is 150
- **THEN** the line reports 200 as the offer price

#### Scenario: A line for a variant that inherits its parent's price

- **WHEN** a line names a variant with no offer price of its own, whose parent product's offer price is 150
- **THEN** the line reports 150 as the offer price

#### Scenario: Reported prices move when the product's do

- **WHEN** a product's offer price is changed after a purchase order line for it was created
- **THEN** that line reports the new offer price, and the line's `unitCost` and `totalCost` are unchanged

### Requirement: A purchase order line may stage new selling prices for its item

A purchase order line MAY carry a staged `offerPrice` and a staged `sellingPrice` for the item it names. Each SHALL be independently optional: absent means the line expresses no opinion about that price, which SHALL be the state of every line that has never had one set.

A staged price SHALL be a proposal recorded on the line and SHALL NOT modify the product or variant at the time it is saved. Staging SHALL be permitted on creation and on amendment of lines, under the same conditions that already govern editing a line.

A staged price SHALL be visible on the line before it is applied, so that a merchant can see what receiving the order would do to the catalogue.

#### Scenario: Staging a price leaves the product alone

- **WHEN** a merchant sets a staged offer price of 170 on a draft purchase order line and saves
- **THEN** the line records 170 as its staged offer price AND the product's own offer price is unchanged

#### Scenario: A line with no staged price

- **WHEN** a purchase order line is created without staged prices
- **THEN** both staged prices are absent, and receiving that line changes no selling price

#### Scenario: Staging one price and not the other

- **WHEN** a line stages an offer price but no regular price
- **THEN** receiving it applies the offer price and leaves the regular price as the product holds it

#### Scenario: A cancelled order never reprices

- **WHEN** a purchase order carrying staged prices is cancelled without being received
- **THEN** no product's prices are changed

### Requirement: A goods receipt applies the received line's staged prices

Receiving quantity against a purchase order line SHALL apply that line's staged prices to the item received — the `ProductVariant` when the line names a variant, otherwise the `Product` — in the same transaction as the stock increase, the `StockMovement`, and the cost-basis recomputation. A receipt SHALL NOT leave stock recorded at a new cost while the selling price the merchant staged against it is unwritten.

Only staged prices that are present SHALL be written; an absent staged price SHALL leave that price as the item holds it. Applying a staged price SHALL NOT clear or alter the line's staged values — the line remains the record of what was applied.

A staged price SHALL be applied once per line, on the first receipt against that line. A subsequent partial receipt against the same line SHALL NOT re-apply it, so that a merchant who corrects a price between two deliveries of one order does not have their correction overwritten.

The application SHALL be recorded on the same audit entry as the receipt's other effects, so that a selling price which changed without a product edit is still attributable.

#### Scenario: Receiving applies the staged offer price

- **WHEN** a line staging an offer price of 170 is received
- **THEN** the product's offer price becomes 170, in the same transaction that increases its stock and moves its cost basis

#### Scenario: A staged price on a variant line

- **WHEN** a line naming a variant and staging an offer price is received
- **THEN** that variant's offer price is set AND its parent product's offer price is unchanged

#### Scenario: A second partial receipt does not re-apply

- **WHEN** a line staging an offer price of 170 is received in part, a merchant then sets the product's offer price to 165, and the remainder of the line is received
- **THEN** the product's offer price remains 165

#### Scenario: A receipt with no staged prices behaves exactly as before

- **WHEN** a purchase order whose lines stage no prices is received
- **THEN** stock, cost basis and status change as they did before staged prices existed, and no selling price is written

#### Scenario: The applied price is attributable to the receipt

- **WHEN** a receipt applies a staged price
- **THEN** the audit trail for that receipt records the price change

### Requirement: The receipt's below-cost warning accounts for staged prices

The notification that reports an item selling at or below cost after a receipt SHALL compare the item's new cost basis against the offer price the receipt leaves in place — the staged offer price where the receipt applied one, otherwise the item's existing offer price.

A receipt SHALL NOT be rejected because a staged price is at or below the new cost basis, for the same reason it is not rejected when an unstaged price is: the goods have arrived, and refusing to record them would leave the stock ledger wrong.

#### Scenario: A staged price that fixes the margin raises no warning

- **WHEN** a receipt lifts an item's cost basis to 115 and the same line stages an offer price of 150
- **THEN** the receipt completes and no below-cost notification is raised for that item

#### Scenario: A staged price that is still below the new cost warns

- **WHEN** a receipt lifts an item's cost basis to 115 and the same line stages an offer price of 110
- **THEN** the receipt completes, the offer price is set to 110, and a notification reports that the item sells below cost

#### Scenario: An unstaged line still warns as before

- **WHEN** a receipt lifts an item's cost basis above its existing offer price and the line stages nothing
- **THEN** the notification is raised exactly as it was before staged prices existed

### Requirement: A staged price may be computed from the line's cost

The system SHALL offer, for computing a staged price, a markup on the line's own unit cost and a fixed-amount adjustment to a price already in hand:

- **markup on unit cost** — the line's `unitCost` increased by a given percentage;
- **fixed adjustment** — a given amount added to or subtracted from a price, never producing a negative price.

Each SHALL produce a figure rounded to the currency's two decimal places, and SHALL produce a value the merchant may then edit. A computation SHALL write only into a staged price and SHALL NOT be stored as a rule, applied automatically, or re-evaluated when the line's cost later changes.

A markup SHALL NOT produce a price for a line whose unit cost is zero or negative, since a percentage of nothing is nothing and would silently propose a price of zero.

#### Scenario: Marking up the unit cost

- **WHEN** a line has a unit cost of 120 and the merchant applies a 25% markup
- **THEN** 150.00 is placed in the staged offer price, editable

#### Scenario: A fixed increase

- **WHEN** a staged offer price of 150 has a fixed adjustment of 20 applied
- **THEN** it becomes 170.00

#### Scenario: A fixed decrease

- **WHEN** a staged offer price of 150 has a fixed adjustment of −30 applied
- **THEN** it becomes 120.00

#### Scenario: A decrease cannot go below zero

- **WHEN** a staged offer price of 20 has a fixed adjustment of −50 applied
- **THEN** it becomes 0.00 rather than a negative price

#### Scenario: Markup on a zero cost proposes nothing

- **WHEN** a line's unit cost is 0 and the merchant applies a markup
- **THEN** no staged price is produced and the merchant is told the line needs a cost first

#### Scenario: A computed price is not a standing rule

- **WHEN** a merchant computes a staged price from a 25% markup and then changes the line's unit cost
- **THEN** the staged price is unchanged until the merchant computes or edits it again
