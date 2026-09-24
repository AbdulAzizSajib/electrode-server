## Purpose

Governs the summary of what is being bought that a shopper reads on the checkout screen immediately before paying — what it shows, and what it lets the shopper change without leaving that screen.

## ADDED Requirements

### Requirement: The checkout summary lets a shopper correct what they are buying

The summary presented on the checkout screen SHALL allow the shopper to change the quantity of a line and to remove a line, without leaving the screen and without losing anything they have already entered into the checkout form.

Changes made there SHALL act on the same cart the summary describes, so that the figures the shopper is asked to pay are recalculated from what they have just changed. The order's totals, including any delivery charge and any applied discount, SHALL reflect the change before the shopper can submit the order.

Reducing a line's quantity below one SHALL remove that line, as it does elsewhere.

Where removing a line would leave nothing to buy, the shopper SHALL NOT be able to submit an empty order, and SHALL be told their cart is now empty rather than being left on a summary of nothing.

#### Scenario: Correcting a quantity before paying

- **WHEN** a shopper on the checkout screen lowers a line's quantity from two to one
- **THEN** the summary shows one
- **AND** the order's subtotal and total are recalculated for one

#### Scenario: Removing a line before paying

- **WHEN** a shopper removes a line from the checkout summary
- **THEN** that line no longer appears in the summary
- **AND** the order's totals are recalculated without it

#### Scenario: Entered details survive the change

- **WHEN** a shopper who has filled in their delivery details changes a quantity in the summary
- **THEN** the details they entered are still there

#### Scenario: Removing the last line

- **WHEN** a shopper removes the only remaining line from the checkout summary
- **THEN** the shopper is told their cart is empty
- **AND** the order cannot be submitted

### Requirement: A corrected order is submitted as corrected

Where the shopper changes what they are buying from the checkout summary, any protection against a duplicate submission SHALL be renewed, so that the order submitted is the corrected one and a submission made before the change cannot be replayed as if it were the change.

A direct purchase that bypasses the cart SHALL NOT present these controls, since there is no cart line to change; such a purchase SHALL continue to be submitted as the single item it is.

#### Scenario: Submitting after a correction

- **WHEN** a shopper changes a quantity in the summary and then submits the order
- **THEN** the order records the corrected quantity

#### Scenario: A direct purchase

- **WHEN** a shopper reaches checkout by buying a single product directly, bypassing the cart
- **THEN** the summary presents no quantity control and no remove control for that item
