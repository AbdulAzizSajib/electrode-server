<!--
  NOTE — WHY THIS IS "ADDED" AND NOT "MODIFIED".

  `commerce/landing-page-orders` does not exist under openspec/specs/ yet: it
  belongs to `add-single-product-landing-page`, still an open change. Archive
  refuses a MODIFIED against a spec that is not there, so this is ADDED and
  archives on its own. Nothing here supersedes an earlier requirement.
-->

## Purpose

How an order placed from a campaign landing page is priced, validated and recorded — a guest order that bypasses the cart and carries the page, the package and the payment it came from.

## ADDED Requirements

### Requirement: A campaign quote states what each payment choice costs
Where a campaign asks for an advance, its price quote SHALL report, for each payment choice, what the shopper sends now and what remains payable on delivery. The two SHALL sum to the order total.

Those figures SHALL be computed by the SAME calculation the shop's own checkout quote uses. A second implementation is forbidden: the figure a shopper reads is the figure they go to another app and send, and the figure the order is then checked against.

#### Scenario: Quote states both choices
- **WHEN** a visitor picks a delivery area on a campaign asking for an advance
- **THEN** the quote reports what the delivery-charge choice costs and what the full-payment choice costs, each with its remaining balance

#### Scenario: The two halves sum to the total
- **WHEN** either choice is quoted
- **THEN** the amount to send now and the amount remaining add up to the order's total

#### Scenario: Campaign not asking for an advance
- **WHEN** a visitor picks a delivery area on a campaign whose switch is off
- **THEN** the quote reports the totals as before, and no advance figures are presented

### Requirement: A campaign order may carry a payment claim
An order placed from a campaign asking for an advance SHALL be able to carry the payment method, the account the money was sent to, the sender's identifier and the transaction reference — the same claim the shop's checkout collects.

The claim SHALL be validated on the same terms: a reference already used SHALL be refused, an account the shop does not hold SHALL be refused, and the amount SHALL be the server's own computation rather than anything the client sends.

A claim on a campaign that does NOT ask for an advance SHALL be refused.

An order carrying a claim SHALL be held until staff verify it, by the same rule and in the same queue as a claim from the shop's checkout. There SHALL NOT be a separate verification path for campaign orders.

#### Scenario: Campaign order with a complete claim
- **WHEN** a visitor submits a campaign order with a payment method, an account, their number and a transaction id
- **THEN** the order is created carrying the claim, and is held for verification

#### Scenario: Claim on a campaign that does not ask for one
- **WHEN** an order arrives with a claim for a campaign whose switch is off
- **THEN** it is refused, and no order is created

#### Scenario: Reused transaction reference
- **WHEN** a campaign order supplies a transaction id another order already claimed
- **THEN** it is refused on the same grounds a shop order would be, and no order is created

#### Scenario: Account the shop does not hold
- **WHEN** a campaign order names an account that is not in the shop's configured accounts
- **THEN** it is refused, and no order is created

#### Scenario: Verified by the same action
- **WHEN** staff open the queue of claims awaiting a decision
- **THEN** claims from campaign pages appear alongside those from the shop's checkout, and are verified by the same action

#### Scenario: Campaign order without a claim
- **WHEN** an order is placed from a campaign whose switch is off
- **THEN** it is recorded as cash on delivery exactly as campaign orders were before this capability existed
