<!--
  NOTE — WHY THIS IS "ADDED".

  `commerce/landing-page-orders` does not exist under openspec/specs/ yet: it
  belongs to `add-single-product-landing-page`, still an open change. Archive
  refuses a MODIFIED against a spec that is not there.

  The first requirement below SUPERSEDES "Delivery is priced by the landing
  page's own delivery zones" in that change. Whichever archives second must
  reconcile the pair; this one is the later decision.
-->

## Purpose

How an order placed from a campaign landing page is priced, validated and recorded — a guest order that bypasses the cart and carries the page, the package, the destination and the payment it came from.

## ADDED Requirements

### Requirement: A campaign order is priced by the shop's delivery options
A campaign order's delivery charge SHALL be the price of one of the shop's own configured delivery options. The campaign SHALL NOT supply a price, and the SERVER SHALL NOT accept one from the request.

An order naming an option the shop does not have SHALL be refused.

#### Scenario: Order priced by a shop option
- **WHEN** a campaign order names one of the shop's delivery options
- **THEN** it is charged that option's stored price

#### Scenario: Client supplies its own delivery price
- **WHEN** a campaign order carries a delivery amount of its own
- **THEN** it is not honoured — the stored price is charged

#### Scenario: Unknown option
- **WHEN** a campaign order names an option the shop does not have
- **THEN** it is refused, and no order is created

#### Scenario: Order records which option was used
- **WHEN** a merchant opens a campaign order
- **THEN** it names the delivery option charged, as a shop order does

### Requirement: A campaign order carries the destination it is going to
A campaign order SHALL record the district and area the shopper chose, in the same form a shop order records them, so an order can be found, briefed to a courier and reconciled the same way regardless of which path produced it.

#### Scenario: Destination recorded
- **WHEN** a visitor places a campaign order having chosen a district and area
- **THEN** the order records that destination

#### Scenario: Staff read one shape
- **WHEN** staff open a campaign order and a shop order side by side
- **THEN** the destination reads the same way on both

#### Scenario: Orders placed before this change
- **WHEN** staff open a campaign order placed before the destination picker existed
- **THEN** it still shows the delivery area it was placed with, unrewritten
