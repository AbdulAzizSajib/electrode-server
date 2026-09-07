## ADDED Requirements

### Requirement: Return status transitions are forward-only
A `ReturnRequest` SHALL only move along transitions that describe a return actually progressing. `COMPLETED` and `CANCELLED` are terminal: once a return reaches either, it SHALL NOT return to an earlier status.

Any interface offering a return's status SHALL offer only the transitions currently legal, so an operator cannot compose a request the system will refuse.

This exists because completing a return restocks goods. Without terminal statuses, a completed return can be moved back and completed again, and the second completion restocks physical goods that came back once — inventing stock the storefront will then sell.

#### Scenario: Reopening a completed return
- **WHEN** an admin attempts to move a `COMPLETED` return back to `APPROVED`
- **THEN** the request is rejected (400) with a message naming the from/to statuses

#### Scenario: The interface does not offer an illegal transition
- **WHEN** an admin opens the status control on a `COMPLETED` return
- **THEN** no earlier status is offered

#### Scenario: Goods are never restocked twice
- **WHEN** completion is attempted against a return already `COMPLETED`
- **THEN** no additional stock is added and no further `RETURN` movement is recorded

### Requirement: Every path that completes a return agrees about restocking
A `ReturnRequest` SHALL reach `COMPLETED` by one rule, whichever action triggers it. Completing a return directly and completing it as a side effect of issuing a refund SHALL NOT disagree about whether the goods came back.

Today the two disagree silently: direct completion requires a warehouse and restocks; refund-triggered completion supplies neither and restocks nothing. The same terminal status therefore means two different things about physical inventory.

Where a completion does not restock, that SHALL be a recorded decision — a refund issued for goods the customer keeps is legitimate, but it SHALL be distinguishable from one where the goods came back.

#### Scenario: A refund completes a return whose goods came back
- **WHEN** an admin issues a refund for a return and indicates the goods were received into a warehouse
- **THEN** the return completes and the stock is restocked exactly as direct completion would restock it

#### Scenario: A refund completes a return whose goods were not returned
- **WHEN** an admin issues a refund without goods coming back
- **THEN** the return completes, no stock is restocked, and the record shows the goods were not received

### Requirement: A recorded refund can be voided or corrected
An OWNER/ADMIN SHALL be able to void a `Refund` recorded in error, and to amend a recorded amount. Both SHALL be audit-logged.

Issuing a refund moves more than one thing: the refund row, the `Payment` status, the associated `ReturnRequest`, and the product's sold count. Voiding SHALL unwind every one of them in a single transaction — a partial unwind leaves the records disagreeing about the same event, which is worse than the original error.

Amending SHALL re-run the same guards that constrain creation, comparing against the order's other refunds but excluding the one being amended, so an amendment is not blocked by the figure it is replacing.

A refund SHALL NOT be corrected by recording a second, compensating refund: refunded amounts are positive, so the correcting entry cannot be expressed, and both entries would then stand as real refunds in the payments report.

#### Scenario: Admin voids a refund entered in error
- **WHEN** an OWNER/ADMIN voids a recorded refund
- **THEN** the refund no longer counts against the order, the payment status returns to what it was, the product's sold count is restored, and any return the refund completed returns to its prior status

#### Scenario: Admin corrects a mistyped refund amount
- **WHEN** an OWNER/ADMIN amends a refund from 5000 to 500
- **THEN** the recorded amount becomes 500 and the order's refunded total reflects only the corrected figure

#### Scenario: An amendment that would over-refund is refused
- **WHEN** an amendment would take the order's total refunded amount above what was paid
- **THEN** the request is rejected (400) and the existing refund is left unchanged

#### Scenario: Voiding is restricted
- **WHEN** a STAFF-role request attempts to void a refund
- **THEN** the response is 403

### Requirement: A shipment timestamp recorded in error can be cleared
`shippedAt` and `deliveredAt` SHALL be clearable, not only settable. A request that omits a timestamp leaves it unchanged; a request that explicitly clears it SHALL remove it.

Today an omitted value and an explicit clear are indistinguishable, so a delivery date stamped on the wrong order is permanent.

#### Scenario: Admin clears a wrongly-stamped delivery date
- **WHEN** an admin explicitly clears `deliveredAt` on a shipment
- **THEN** the field is emptied and the shipment no longer reads as delivered

#### Scenario: Omitting a timestamp leaves it alone
- **WHEN** an admin updates a shipment's carrier without mentioning its timestamps
- **THEN** `shippedAt` and `deliveredAt` keep their existing values

## MODIFIED Requirements

### Requirement: Refunds are tied to a specific order and, optionally, a specific payment
A `Refund` SHALL always reference its `Order`; when it corresponds to a specific `Payment` (e.g. multiple payment attempts on one order), that link SHALL be recorded.

A refund's side effects — the `Payment` status it moves, the `ReturnRequest` it completes, and the product sold counts it adjusts — SHALL be applied in one transaction with the refund itself, and SHALL be reversible together when the refund is voided.

#### Scenario: Admin issues a refund after approving a return
- **WHEN** an admin approves a `ReturnRequest` and issues a refund for it
- **THEN** a `Refund` row is created against the order (and payment, if determinable), and the return's status moves to a terminal state

#### Scenario: A refund's side effects are reversed with it
- **WHEN** a refund that completed a return and moved a payment's status is voided
- **THEN** the return, the payment status, and the sold counts all return to what they were before the refund was recorded
