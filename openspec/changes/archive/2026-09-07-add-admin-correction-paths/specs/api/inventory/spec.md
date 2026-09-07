## ADDED Requirements

### Requirement: The unreceived part of a purchase order can be amended
A purchase order that has begun receiving SHALL still allow correction of what has NOT yet arrived: a line's outstanding quantity and its unit cost SHALL be amendable, and a line that has received nothing SHALL be removable, with new lines addable.

Quantities already received SHALL NOT be amendable. A receipt moved real stock and established a cost basis from what was actually paid; rewriting it would make the ledger disagree with the goods on the shelf.

Today the first partial receipt freezes the entire document, and line items are not editable even before that — so a wrong quantity discovered mid-delivery has no correction at all, and the only route is a second purchase order that double-counts the commitment to the supplier.

#### Scenario: Admin corrects an outstanding quantity after a partial receipt
- **WHEN** an admin reduces a line's ordered quantity to a figure still at or above what that line has already received
- **THEN** the line is updated, the order's subtotal and total are recomputed, and the received quantity is untouched

#### Scenario: Reducing a line below what already arrived is refused
- **WHEN** an amendment would set a line's quantity below its `receivedQuantity`
- **THEN** the request is rejected (400) naming the quantity already received

#### Scenario: A line that has received stock cannot be removed
- **WHEN** an admin attempts to remove a line whose `receivedQuantity` is above zero
- **THEN** the request is rejected (400)

#### Scenario: Adding a line to a partially received order
- **WHEN** a supplier ships an item that was not on the original order and an admin adds it as a new line
- **THEN** the line is added, the order's totals are recomputed, and the line is available to receive

### Requirement: An amended purchase order total keeps supplier payments payable
Recomputing a purchase order's totals after an amendment SHALL keep the figure that supplier payments are judged against in step with what was actually ordered.

A purchase order's total caps what may be recorded as paid to the supplier. While the total was frozen, an understated order permanently capped legitimate payments below what the supplier invoiced, with no way to raise it.

An amendment SHALL NOT reduce a purchase order's total below what has already been paid against it.

#### Scenario: Payments become recordable after an upward amendment
- **WHEN** a purchase order's total rises through an amendment
- **THEN** supplier payments up to the new total are accepted

#### Scenario: An amendment below money already paid is refused
- **WHEN** an amendment would take the order's total below the sum of payments already recorded against it
- **THEN** the request is rejected (400) naming the amount already paid

## MODIFIED Requirements

### Requirement: Stock changes are always logged as a StockMovement
Any change to `Stock.quantity` SHALL be accompanied by a `StockMovement` row recording the type (purchase, sale, return, adjustment, etc.) and quantity delta — `Stock` is never edited directly without a corresponding audit trail entry.

A movement's type SHALL describe what actually happened. A correction SHALL NOT be recorded as an event of a different kind: stock returned by a cancelled order is not a manual adjustment, and stock moved between variants of the same product is neither a loss nor a gain. Correcting an earlier entry SHALL append a compensating movement rather than editing or deleting the original — the history is what an admin reads to explain a discrepancy, and a history that can be rewritten explains nothing.

#### Scenario: Admin manually adjusts stock
- **WHEN** an admin corrects a warehouse's stock count for a product
- **THEN** `Stock.quantity` changes AND a `StockMovement` with `type: ADJUSTMENT` is created recording the delta and an optional note

#### Scenario: A correction does not masquerade as a physical change
- **WHEN** stock is returned by a cancellation, or moved onto the variant it belongs to
- **THEN** the movement recorded distinguishes that correction from a manual adjustment of the count

### Requirement: Receiving a purchase order increases stock and records the movement
Marking `PurchaseOrderItem.receivedQuantity` up SHALL increase the corresponding `Stock.quantity` at the purchase order's implied warehouse and create a `StockMovement` with `type: PURCHASE`.

Receipt SHALL credit the stock a customer order can actually deduct against. For a product with variants, that is the variant the line names — stock received against a variable product but no variant is unsellable, because orders deduct by variant.

#### Scenario: Partial receipt of a purchase order
- **WHEN** an admin receives less than the full ordered quantity for a `PurchaseOrderItem`
- **THEN** `PurchaseOrder.status` becomes `PARTIALLY_RECEIVED`, stock increases by only the received quantity, and the item remains open for further receipt

#### Scenario: Receiving stock for a variable product
- **WHEN** a purchase order line for a product with variants is received
- **THEN** the stock is credited to that line's variant, and the storefront can sell it as that variant
