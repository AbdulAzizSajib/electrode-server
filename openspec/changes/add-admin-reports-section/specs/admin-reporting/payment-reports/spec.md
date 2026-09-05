## Purpose

Defines Payment history: a single chronological view of money moving in both directions — received from customers against orders and paid to suppliers against purchase orders — so a merchant can see everything that happened to their money in a period in one place.

## ADDED Requirements

### Requirement: Payment history covers money in and money out in one chronological list

The system SHALL list, for a chosen date range, both payments received from customers and payments made to suppliers, in one list ordered by date. Every row SHALL state its direction unambiguously.

#### Scenario: Both directions present

- **WHEN** a range contains three customer payments and two supplier payments
- **THEN** all five appear in one list ordered by date, each marked as money in or money out

#### Scenario: Direction is legible at a glance

- **WHEN** the list is shown
- **THEN** money in and money out are visually distinguished from each other, not left to be inferred from the amount's sign alone

#### Scenario: Direction filter

- **WHEN** a merchant filters to money out only
- **THEN** only supplier payments are listed, and every total on the page describes supplier payments alone

#### Scenario: Report is not a ledger

- **WHEN** a merchant views Payment history
- **THEN** it presents dated payment rows with in/out totals, and does not present debit and credit columns, account balances or a running account balance

### Requirement: Each payment row identifies what it settles and who it involves

The system SHALL show, for every row, the date, direction, amount, method, status, the counterparty (customer or supplier), the document it settles (order number or purchase number), and any external reference recorded against it. The document reference SHALL link to that order or purchase order.

#### Scenario: Customer payment row

- **WHEN** a customer payment is listed
- **THEN** it names the customer, the order number, the method, the status and the amount, and its order number links to that order

#### Scenario: Supplier payment row

- **WHEN** a supplier payment is listed
- **THEN** it names the supplier, the purchase number, the method, the amount and any reference, and its purchase number links to that purchase order

#### Scenario: Guest order payment

- **WHEN** a payment belongs to an order placed by a guest
- **THEN** the counterparty is shown as the name recorded on that order, marked as a guest, rather than being left blank

#### Scenario: Underlying document was deleted

- **WHEN** a payment's order or purchase order no longer exists
- **THEN** the payment is still listed with its amount and date, and the missing document is stated rather than the row being dropped

### Requirement: Payments are dated by when the money moved, not when the record was created

The system SHALL place a payment in a period by the date the money moved — the settlement date for a settled customer payment and the recorded payment date for a supplier payment. Where a customer payment has not settled, the system SHALL use the date it was recorded and SHALL mark that the date is a record date rather than a settlement date.

#### Scenario: Payment recorded and settled on different days

- **WHEN** a payment was recorded on 28 February and settled on 2 March, and the range is March
- **THEN** it appears in the March report

#### Scenario: Unsettled payment

- **WHEN** a cash-on-delivery payment was recorded on 5 March and has not settled
- **THEN** it appears under 5 March, marked as not yet settled, with its date identified as a record date

#### Scenario: Backdated supplier payment

- **WHEN** a supplier payment is recorded today but dated 20 March by the merchant
- **THEN** it appears under 20 March

### Requirement: Payment history totals state money in, money out and the net movement

The system SHALL state, over the whole filtered result, total money in, total money out, and the net movement (money in minus money out). Money in SHALL count only settled customer payments; unsettled amounts SHALL be stated separately and SHALL NOT be added to money in.

#### Scenario: Totals over a mixed range

- **WHEN** a range contains ৳80,000 of settled customer payments and ৳50,000 of supplier payments
- **THEN** the report states ৳80,000 in, ৳50,000 out and ৳30,000 net

#### Scenario: Unsettled money is not counted as received

- **WHEN** a range contains ৳20,000 of recorded but unsettled customer payments
- **THEN** that ৳20,000 is stated as pending and is not included in money in

#### Scenario: Refunded payments

- **WHEN** a customer payment in the range has since been refunded
- **THEN** it is listed with a refunded status, and the amount refunded is stated separately from money in rather than silently removed from it

#### Scenario: Totals respect filters

- **WHEN** any filter is applied
- **THEN** money in, money out and net are recomputed over the filtered result

### Requirement: Payment history can be narrowed by direction, method, status and counterparty

The system SHALL let a merchant narrow Payment history by direction, by payment method, by status, and to a single customer or a single supplier. Method options SHALL be those valid for the selected direction.

#### Scenario: Filtered by method

- **WHEN** a merchant filters to a mobile-money method
- **THEN** only payments made or received by that method are listed

#### Scenario: Method options follow direction

- **WHEN** a merchant filters to money out
- **THEN** only methods that money-out payments can use are offered, and customer-only methods such as cash on delivery are not

#### Scenario: Filtered to one supplier

- **WHEN** a merchant filters to one supplier
- **THEN** only that supplier's payments are listed and the totals describe that supplier alone

#### Scenario: Filtered to pending

- **WHEN** a merchant filters to pending status
- **THEN** only payments that have not settled are listed, which is how a merchant finds uncollected cash-on-delivery money
