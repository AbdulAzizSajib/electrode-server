## ADDED Requirements

### Requirement: Advance payment is a store-wide setting, off by default
The merchant SHALL be able to turn advance payment on or off for the whole store. While it is off, checkout SHALL behave exactly as it does without this change: cash on delivery, nothing collected up front, no payment choice presented. A store that has never configured the setting SHALL be treated as having it off.

The setting SHALL NOT be turnable on while the merchant has configured no payment account for the shopper to send money to, because the resulting checkout would ask for a transaction id against no account.

#### Scenario: Setting absent on an existing store
- **WHEN** checkout is read for a store whose settings predate this change
- **THEN** advance payment is reported as off, and the order flow is the unchanged cash-on-delivery flow

#### Scenario: Merchant turns it on with no account configured
- **WHEN** the merchant saves settings enabling advance payment while both the mobile-banking and bank account lists are empty
- **THEN** the save is rejected (400) naming the missing accounts, and the stored setting remains off

#### Scenario: Merchant turns it off again
- **WHEN** advance payment is switched off while orders awaiting verification exist
- **THEN** the save succeeds, new checkouts stop offering the choice, and the existing orders remain blocked on their own verification

### Requirement: Advance payment offers two choices that differ only in amount
When advance payment is on, checkout SHALL present exactly two choices: pay the delivery charge in advance and the remainder on delivery, or pay the whole order total in advance. Both SHALL collect the same details and follow the same verification path; they differ only in the amount the shopper is asked to send.

The amount to send SHALL be computed by the server, not accepted from the client. The advance amount and the remaining amount SHALL both be stated to the shopper before they are asked for a transaction id, and SHALL sum to the order total.

#### Scenario: Delivery-charge-only choice
- **WHEN** a shopper on a ৳920 order with a ৳130 delivery charge selects the delivery-charge-only choice
- **THEN** checkout states ৳130 to send now and ৳790 due on delivery, and the order records an advance of ৳130

#### Scenario: Full-payment choice
- **WHEN** the same shopper selects the full-payment choice
- **THEN** checkout states ৳920 to send now and nothing due on delivery, and the order records an advance of ৳920

#### Scenario: Delivery option changed after a choice is made
- **WHEN** the shopper selects a payment choice and then changes their delivery option to one with a different charge
- **THEN** the stated advance amount is recomputed before submission, and an order submitted against a stale amount is rejected (409) rather than created for the wrong sum

#### Scenario: Client submits its own amount
- **WHEN** an order request carries an advance amount that does not match what the server computes for the selected choice and delivery option
- **THEN** the request is rejected (400) and no order is created

### Requirement: An advance payment claim records who sent what, to which account
An order placed with advance payment SHALL capture the payment method, the merchant account the money was sent to, the sender's own number or account identifier, and the transaction reference. All four SHALL be required; an order SHALL NOT be created with any of them missing or blank.

The merchant account SHALL be identified by reference to one the merchant has configured, not by a value copied from the client, so that a claim cannot name an account the merchant does not hold.

#### Scenario: Complete claim
- **WHEN** a shopper selects bKash, picks the merchant's configured bKash account, and supplies their own number and a transaction id
- **THEN** the order is created and the payment record carries all four values

#### Scenario: Missing transaction id
- **WHEN** an order request selects an advance-payment choice but carries no transaction id
- **THEN** the request is rejected (400) naming the missing field, and no order is created

#### Scenario: Claim names an unconfigured account
- **WHEN** an order request references a merchant account that is not in the store's configured accounts
- **THEN** the request is rejected (400) and no order is created

#### Scenario: Bank transfer claim
- **WHEN** a shopper selects bank transfer and supplies the depositor's name or account number as the sender identifier plus a deposit slip reference
- **THEN** the order is created and the payment record carries the bank account chosen, the sender identifier and the reference

### Requirement: A transaction reference may only be claimed once
A transaction reference already recorded against any payment SHALL NOT be accepted again. The rejection SHALL name the reused reference as the problem rather than surfacing a storage error.

#### Scenario: Reference reused on a second order
- **WHEN** a shopper places an order supplying a transaction id that another order already claimed
- **THEN** the request is rejected (409) stating that the transaction id has already been used, and no order is created

#### Scenario: Rejected claim's reference is reused
- **WHEN** a shopper whose earlier claim was rejected by an admin submits a new order with that same transaction id
- **THEN** the request is rejected (409) on the same grounds — a rejected claim still occupies its reference

### Requirement: An order awaiting payment verification cannot advance in status
An order carrying an advance payment that has not been verified SHALL remain at its initial status. Any attempt to move it forward — to confirmed, processing, packed, shipped, delivered or completed — SHALL be rejected, naming verification as the reason. Cancelling such an order SHALL remain permitted.

This is the constraint the whole change exists for. Without it a shopper types any eleven digits into the transaction id field and the order is packed and dispatched exactly as an unverified one would have been.

#### Scenario: Admin tries to confirm before verifying
- **WHEN** an admin attempts to move an order with an unverified advance payment to confirmed
- **THEN** the request is rejected (409) stating that the advance payment has not been verified, and the order's status is unchanged

#### Scenario: Order advances once verified
- **WHEN** an admin verifies the advance payment and then moves the order to confirmed
- **THEN** the transition succeeds and is appended to the order's status history as any other transition is

#### Scenario: Rejected claim leaves the order blocked
- **WHEN** an admin rejects the advance payment claim and then attempts to confirm the order
- **THEN** the request is rejected (409) — a rejected claim is not a verified one

#### Scenario: Cancelling is still allowed
- **WHEN** an admin cancels an order whose advance payment is unverified
- **THEN** the cancellation succeeds and the order's stock is returned as it is for any cancelled order

#### Scenario: A plain cash-on-delivery order is unaffected
- **WHEN** an order placed without advance payment is moved to confirmed
- **THEN** the transition succeeds with no verification check applied

### Requirement: The storefront reads merchant payment accounts but never a secret
The account details a shopper must read in order to send money — mobile-banking numbers, bank account names, numbers, branches and routing numbers — SHALL be served to the storefront as part of the store's public settings. No credential, token or key SHALL be served alongside them.

#### Scenario: Storefront renders the accounts
- **WHEN** the storefront reads public store settings for a store with advance payment on
- **THEN** the configured mobile-banking and bank accounts are present in the response, each with the details needed to send money to it

#### Scenario: Advance payment off
- **WHEN** the storefront reads public store settings for a store with advance payment off
- **THEN** the response reports the mode as off, and checkout presents no payment choice

## MODIFIED Requirements

### Requirement: Order status transitions are constrained
An order's status SHALL only move along transitions that describe something that can actually happen. A transition that contradicts the order's history — reviving a cancelled order as delivered, or returning a completed order to pending — SHALL be rejected, naming the attempted transition.

Today the only check is that the status is changing at all, so any status can follow any other. That matters beyond tidiness: money- and inventory-bearing side effects key off these transitions, and a transition that could never occur physically produces side effects that cannot be reconciled.

A transition that is legal by this rule SHALL still be refused while the order is awaiting verification of an advance payment, as specified in "An order awaiting payment verification cannot advance in status". The two checks are separate: legality describes what can follow what, verification describes whether this particular order may move at all yet.

#### Scenario: Reviving a cancelled order
- **WHEN** an admin attempts to move a `CANCELLED` order to `DELIVERED`
- **THEN** the request is rejected (400) with a message naming the from/to statuses

#### Scenario: A legal transition still succeeds
- **WHEN** an admin moves an order from `PROCESSING` to `SHIPPED`
- **THEN** the transition succeeds and is appended to the order's status history as before

#### Scenario: A legal transition on an unverified order
- **WHEN** an admin attempts a legal transition on an order whose advance payment is unverified
- **THEN** the request is rejected on verification grounds, with a message distinguishing it from an illegal transition
