## Purpose

Defines how buying is summarised over a period — which purchase orders count, what was ordered against what actually arrived, what it cost, how much of it has been paid for, and how much is still owed to each supplier.

## ADDED Requirements

### Requirement: The Purchases report covers purchase orders raised in the chosen range

The system SHALL include a purchase order in the Purchases report when it was raised inside the chosen date range. Draft purchase orders SHALL be excluded from money figures by default, because a draft is not yet a commitment, and the merchant SHALL be able to include them explicitly.

#### Scenario: Ordered purchase order inside the range

- **WHEN** a purchase order was raised on 8 March and the range is 1–31 March
- **THEN** it is included

#### Scenario: Draft purchase order

- **WHEN** a purchase order inside the range is still a draft and drafts are not being included
- **THEN** it does not contribute to any quantity or money figure, and the report states how many drafts were left out

#### Scenario: Drafts included on request

- **WHEN** a merchant chooses to include drafts
- **THEN** drafts contribute to the figures and are visibly marked as drafts in the rows

#### Scenario: Cancelled purchase order

- **WHEN** a purchase order inside the range has been cancelled
- **THEN** it is excluded from ordered value and outstanding amounts, and is listed as cancelled so the merchant can see it existed

### Requirement: The Purchases report distinguishes what was ordered from what arrived

The system SHALL report, per purchase order, the quantity ordered and the quantity actually received, and SHALL identify purchase orders that are only partly received.

#### Scenario: Fully received purchase order

- **WHEN** a purchase order for 100 units has received all 100
- **THEN** it shows 100 ordered, 100 received and nothing outstanding on quantity

#### Scenario: Partly received purchase order

- **WHEN** a purchase order for 100 units has received 60
- **THEN** it shows 100 ordered, 60 received and 40 still to arrive, and is marked as partly received

#### Scenario: Nothing received yet

- **WHEN** a purchase order has been placed but nothing has arrived
- **THEN** it shows its full ordered quantity, zero received, and is marked as awaiting delivery

### Requirement: The Purchases report reports purchase value, amount paid and amount owed

The system SHALL report, per purchase order and as totals over the filtered result, the purchase value including shipping and tax, the amount paid to the supplier against it, and the balance still owed (purchase value minus amount paid).

#### Scenario: Unpaid purchase order

- **WHEN** a purchase order totalling ৳50,000 has no payments recorded
- **THEN** it shows ৳50,000 purchase value, ৳0 paid and ৳50,000 owed

#### Scenario: Partly paid purchase order

- **WHEN** ৳30,000 has been paid against a ৳50,000 purchase order
- **THEN** it shows ৳30,000 paid and ৳20,000 owed

#### Scenario: Fully paid purchase order

- **WHEN** the full ৳50,000 has been paid
- **THEN** it shows ৳0 owed and is marked as settled

#### Scenario: Totals reconcile

- **WHEN** the report is shown
- **THEN** the total purchase value minus the total paid equals the total owed

#### Scenario: Purchase value decomposes

- **WHEN** any purchase order is included
- **THEN** its item subtotal plus shipping cost plus tax equals its stated purchase value

### Requirement: Purchases can be grouped by supplier, by status or by day

The system SHALL let a merchant group the Purchases report by supplier, by purchase order status, or by day. Group figures SHALL sum to the report total for the same measure.

#### Scenario: Grouped by supplier

- **WHEN** a merchant groups by supplier
- **THEN** one row per supplier is shown with the number of purchase orders, purchase value, amount paid and amount owed, ordered by amount owed descending so the largest liability is first

#### Scenario: Grouped by status

- **WHEN** a merchant groups by status
- **THEN** one row per purchase order status present in the range is shown with a count and a purchase value

#### Scenario: Grouped by day

- **WHEN** a merchant groups by day
- **THEN** one row per day with purchasing activity is shown, and the daily values sum to the range total

#### Scenario: Group totals reconcile

- **WHEN** any grouping is applied
- **THEN** the sum of the group figures equals the report total for that measure

### Requirement: The Purchases report can be narrowed to a supplier, a status or a settlement state

The system SHALL let a merchant narrow the Purchases report to a single supplier, to one or more purchase order statuses, and to purchase orders that still owe money. Every figure and grouping SHALL respect the applied filters.

#### Scenario: Filtered to one supplier

- **WHEN** a merchant filters to one supplier
- **THEN** every figure covers that supplier's purchase orders alone, and the totals state that supplier's outstanding balance for the range

#### Scenario: Filtered to unpaid purchase orders

- **WHEN** a merchant filters to purchase orders with a balance owing
- **THEN** only purchase orders whose amount paid is less than their purchase value are listed

#### Scenario: Supplier has been deactivated

- **WHEN** a supplier is inactive but has purchase orders inside the range
- **THEN** those purchase orders are still reported, and the supplier is marked inactive rather than being omitted
