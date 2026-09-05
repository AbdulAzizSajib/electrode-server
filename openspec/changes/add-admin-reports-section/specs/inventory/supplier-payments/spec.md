## Purpose

Defines recording money paid to a supplier against a purchase order — what a payment record states, how it produces a paid and outstanding balance on that purchase order, and the rules that stop a payment from being recorded against something it cannot settle.

## ADDED Requirements

### Requirement: A payment to a supplier can be recorded against a purchase order

The system SHALL let an authorised staff member record a payment made to a supplier against a specific purchase order, capturing the amount, the method used, the date the money moved, an optional external reference, and an optional note. The supplier SHALL be taken from the purchase order rather than chosen separately, so a payment can never name a supplier the purchase order does not belong to.

#### Scenario: Staff member records a payment

- **WHEN** a staff member records ৳30,000 paid by bank transfer against a purchase order, dated today, with a transaction reference
- **THEN** the payment is stored against that purchase order and its supplier, and appears in the purchase order's payment list

#### Scenario: Supplier is not separately selectable

- **WHEN** the record-payment form is opened from a purchase order
- **THEN** the supplier is shown as the purchase order's supplier and cannot be changed

#### Scenario: Payment date defaults to today but can be backdated

- **WHEN** the record-payment form is opened
- **THEN** the payment date defaults to today, and the merchant can set an earlier date to record a payment made previously

#### Scenario: Several payments against one purchase order

- **WHEN** three separate payments are recorded against one purchase order
- **THEN** all three are listed against it with their own dates, amounts, methods and references

### Requirement: A supplier payment amount must be positive and cannot exceed what is owed

The system SHALL reject a payment whose amount is zero or negative. The system SHALL reject a payment that would take the total paid on a purchase order above that purchase order's total value.

#### Scenario: Zero or negative amount

- **WHEN** a payment of zero or a negative amount is submitted
- **THEN** it is rejected with a message naming the amount, and nothing is stored

#### Scenario: Payment exceeds the outstanding balance

- **WHEN** ৳30,000 has already been paid against a ৳50,000 purchase order and a further ৳25,000 is submitted
- **THEN** it is rejected, stating the outstanding balance of ৳20,000, and nothing is stored

#### Scenario: Payment exactly settles the balance

- **WHEN** ৳20,000 is submitted against a ৳50,000 purchase order with ৳30,000 already paid
- **THEN** it is accepted and the purchase order becomes fully settled

#### Scenario: Concurrent payments cannot overshoot together

- **WHEN** two payments are submitted at the same moment that would together exceed the outstanding balance
- **THEN** at most the amount that fits is accepted and the other is rejected, and the total paid never exceeds the purchase order total

### Requirement: A payment cannot be recorded against a cancelled or draft purchase order

The system SHALL reject a payment against a purchase order that has been cancelled or is still a draft, because neither represents a commitment that can be settled.

#### Scenario: Cancelled purchase order

- **WHEN** a payment is submitted against a cancelled purchase order
- **THEN** it is rejected with a message explaining that a cancelled purchase order cannot be paid

#### Scenario: Draft purchase order

- **WHEN** a payment is submitted against a draft purchase order
- **THEN** it is rejected with a message explaining that the purchase order must be placed first

#### Scenario: Record payment is unavailable in the UI

- **WHEN** a staff member views a cancelled or draft purchase order
- **THEN** no record-payment action is offered, so the rejection above is a backstop rather than the merchant's first hint

#### Scenario: Purchase order cancelled after payments exist

- **WHEN** a purchase order with recorded payments is cancelled
- **THEN** the cancellation is refused while payments exist against it, stating that the payments must be removed first, so paid money is never left attached to a cancelled document

### Requirement: A purchase order states how much has been paid and how much is owed

The system SHALL expose, wherever a purchase order is read, the total amount paid against it and the balance still owed, computed as its total value minus the total paid. The purchase order detail view SHALL show its payments alongside those figures.

#### Scenario: Purchase order detail shows the balance

- **WHEN** a staff member opens a purchase order totalling ৳50,000 with ৳30,000 paid
- **THEN** the page states ৳50,000 total, ৳30,000 paid and ৳20,000 due, and lists the payments that make up the ৳30,000

#### Scenario: Purchase order with no payments

- **WHEN** a purchase order has no payments
- **THEN** it states ৳0 paid and the full total as due, and its payment list shows an empty state rather than being absent

#### Scenario: Figures reconcile

- **WHEN** a purchase order is read
- **THEN** the sum of its payments equals the stated amount paid, and total minus amount paid equals the stated balance due

#### Scenario: Purchase order list shows settlement state

- **WHEN** a staff member views the purchase order list
- **THEN** each row shows whether it is unpaid, partly paid or settled, so unsettled purchases are findable without opening each one

### Requirement: A supplier payment can be corrected or removed by an authorised staff member

The system SHALL let an authorised staff member amend or delete a recorded supplier payment, and SHALL recompute the purchase order's paid and outstanding figures immediately. Every creation, amendment and deletion SHALL be written to the audit trail with the acting user and the amount.

#### Scenario: Payment amount is corrected

- **WHEN** a payment of ৳30,000 is corrected to ৳25,000
- **THEN** the purchase order's amount paid falls to ৳25,000 and its balance due rises accordingly

#### Scenario: Payment recorded in error is deleted

- **WHEN** a payment recorded against the wrong purchase order is deleted
- **THEN** it is removed from that purchase order's payment list and its figures are recomputed without it

#### Scenario: Correction cannot overshoot

- **WHEN** a payment is amended to an amount that would take total paid above the purchase order total
- **THEN** the amendment is rejected and the stored payment is unchanged

#### Scenario: Every change is audited

- **WHEN** a supplier payment is created, amended or deleted
- **THEN** an audit entry records the action, the purchase order, the amount and the acting user

### Requirement: Supplier payment methods describe money going out

The system SHALL offer a set of payment methods appropriate to paying a supplier, and SHALL NOT offer methods that only make sense for money coming in from a customer.

#### Scenario: Outgoing methods are offered

- **WHEN** a staff member opens the method selector on a supplier payment
- **THEN** methods appropriate to paying a supplier — including cash, bank transfer, cheque and mobile money — are offered

#### Scenario: Customer-only methods are not offered

- **WHEN** a staff member opens the method selector on a supplier payment
- **THEN** cash on delivery is not offered, because a supplier payment is not collected from a courier

#### Scenario: An unrecognised method is rejected

- **WHEN** a payment is submitted with a method outside the offered set
- **THEN** it is rejected and nothing is stored

### Requirement: Supplier payments are visible only to admin-panel staff

The system SHALL restrict reading and writing supplier payments to store owners, administrators and staff. Supplier payment data SHALL NOT be reachable by a customer session or an unauthenticated request, and SHALL NOT appear on any storefront surface.

#### Scenario: Customer session attempts to read

- **WHEN** a request carrying a customer session asks for a purchase order's payments
- **THEN** it is rejected as unauthorised

#### Scenario: Unauthenticated write attempt

- **WHEN** an unauthenticated request attempts to record a supplier payment
- **THEN** it is rejected and nothing is stored
