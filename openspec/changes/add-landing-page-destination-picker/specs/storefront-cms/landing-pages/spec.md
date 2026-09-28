<!--
  NOTE — WHY THIS IS "ADDED" AND NOT "MODIFIED"/"REMOVED".

  `storefront-cms/landing-pages` does not exist under openspec/specs/ yet: it
  belongs to `add-single-product-landing-page`, still an open change, as are
  the changes extending it. Archive refuses a MODIFIED or REMOVED against a
  spec that is not there, so this is written as ADDED and archives on its own.

  The first requirement below SUPERSEDES "Delivery is priced by the landing
  page's own delivery zones" in `add-single-product-landing-page`. Whichever
  change archives second must reconcile the pair — this one is the later
  decision.
-->

## Purpose

What a single-product campaign landing page is: the content a merchant authors on it, the offer mechanics it can carry, how it is themed and paid for, and how the storefront renders it as a chrome-free document built to convert ad traffic.

## ADDED Requirements

### Requirement: A campaign's delivery charge comes from the shop's own options
A landing page SHALL NOT author delivery prices of its own. The charge on a campaign order SHALL be one of the shop's configured delivery options, the same options the shop's own checkout prices from.

Changing a delivery option's price SHALL change it on every campaign, without any campaign being edited.

A merchant SHALL NOT be able to declare a delivery price on a campaign by any route.

#### Scenario: Merchant changes a delivery price
- **WHEN** the merchant changes the outside-Dhaka option's price in the shop's settings
- **THEN** every campaign charges the new price, with no campaign edited

#### Scenario: The same address costs the same either way
- **GIVEN** a shopper at a given address
- **WHEN** they order the same product through the shop's checkout and through a campaign page
- **THEN** the delivery charge is the same in both

#### Scenario: Campaign attempts its own price
- **WHEN** a merchant tries to save a delivery price on a landing page
- **THEN** no such field is accepted

### Requirement: A campaign asks where the order is going, not which zone it is in
A landing page's order form SHALL ask for a destination — a district and an area — rather than asking the shopper to classify their own address into a delivery band.

The delivery charge SHALL be DERIVED from that destination and shown to the shopper. The shopper SHALL NOT be asked to choose it while a destination resolves.

#### Scenario: Shopper picks a destination
- **WHEN** a visitor chooses their district and area on a campaign page
- **THEN** the delivery charge for that place is shown, and no delivery-band choice is presented

#### Scenario: Charge follows the destination
- **WHEN** the visitor changes their destination to one in a different band
- **THEN** the stated delivery charge and the order total both change to match

#### Scenario: Before a destination is chosen
- **WHEN** a visitor has not yet chosen a destination
- **THEN** no delivery charge is stated, and they are not shown an error for not having answered

### Requirement: Where no charge can be derived, the shopper is asked
Where a destination resolves to no configured option — an unserved district, or a band the merchant has not priced — the campaign SHALL present the shop's delivery options for the shopper to choose from, and SHALL state why.

This fallback SHALL be reached only after a destination has been given. A campaign SHALL NOT open by asking the shopper to choose a delivery band.

#### Scenario: Unserved district
- **WHEN** a visitor chooses a district the shop does not deliver to
- **THEN** the shop's delivery options are presented, with the reason stated

#### Scenario: Band not priced
- **WHEN** a destination resolves to a band the merchant has configured no option for
- **THEN** the options are presented, with the reason stated

#### Scenario: The fallback is not the opening question
- **WHEN** a visitor first opens a campaign page
- **THEN** the destination field is asked and no delivery options are presented

#### Scenario: Resolving again clears the fallback
- **WHEN** a visitor changes from an unserved district to one that resolves
- **THEN** the derived charge is shown and the options are withdrawn
