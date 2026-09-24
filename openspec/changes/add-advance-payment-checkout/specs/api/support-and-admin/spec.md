## ADDED Requirements

### Requirement: An advance payment claim is verified or rejected by staff, never by the payer
A claimed advance payment SHALL be reviewable by staff, who may either verify it — recording that the money arrived — or reject it with a reason. Only staff SHALL be able to make that decision. A customer SHALL NOT be able to verify a payment on their own order by any route, including the endpoint by which they submitted the claim.

Verification is a human act: the merchant reads their own bKash, Nagad or bank statement and matches it against the claim. The system's job is to present what was claimed and to record which staff member decided what, not to judge the claim itself.

#### Scenario: Staff verifies a claim
- **WHEN** a staff user verifies an advance payment claim of ৳130
- **THEN** the payment is recorded as paid with the time it was verified and the staff user who verified it, and the order becomes eligible to advance in status

#### Scenario: Staff rejects a claim
- **WHEN** a staff user rejects a claim, supplying a reason
- **THEN** the payment is recorded as failed with that reason, the rejecting user and the time, and the order remains blocked from advancing

#### Scenario: Customer attempts to verify their own payment
- **WHEN** a customer calls the payment endpoints attempting to move their own claimed payment to paid
- **THEN** the request is rejected (403) and the payment is unchanged

#### Scenario: Rejection without a reason
- **WHEN** a staff user rejects a claim without supplying a reason
- **THEN** the request is rejected (400) — a rejection the shopper cannot be told the grounds for is not actionable by anyone

### Requirement: A verification decision is auditable and reversible only forward
Verifying or rejecting an advance payment SHALL be recorded in the audit log, naming the acting user, the order, the payment, the decision and the amount. A decision SHALL NOT be silently overwritten: correcting a rejection SHALL be a new verification that leaves the rejection and its reason in the record.

#### Scenario: Verification is logged
- **WHEN** a staff user verifies a claim
- **THEN** an audit entry records that user, the order, the payment, the decision and the amount

#### Scenario: Correcting a mistaken rejection
- **WHEN** a staff user verifies a payment they previously rejected
- **THEN** the payment becomes paid, the order is released, and both the rejection and the later verification remain in the audit log

#### Scenario: Re-verifying an already verified payment
- **WHEN** a staff user verifies a payment that is already verified
- **THEN** the request is rejected (409) rather than writing a second verification over the first

### Requirement: Staff can see what was claimed without leaving the order
An order's detail SHALL present the advance payment claim in full to staff: the amount claimed, the method, which of the merchant's accounts it names, the sender's number or account identifier, the transaction reference, and the current decision with its actor and time. Staff SHALL NOT have to consult another screen to decide.

#### Scenario: Unverified claim on an order
- **WHEN** staff open an order whose advance payment is unverified
- **THEN** the claimed amount, method, merchant account, sender identifier and transaction reference are shown, together with the amount still due on delivery

#### Scenario: Decided claim on an order
- **WHEN** staff open an order whose claim has been verified or rejected
- **THEN** the same claim details are shown alongside the decision, who made it and when, and any rejection reason
