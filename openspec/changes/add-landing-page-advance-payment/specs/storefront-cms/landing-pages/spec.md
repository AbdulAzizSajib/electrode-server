<!--
  NOTE — WHY THIS IS "ADDED" AND NOT "MODIFIED".

  `storefront-cms/landing-pages` does not exist under openspec/specs/ yet: it
  belongs to `add-single-product-landing-page`, which is still an open change,
  as are the two that extend it. Archive refuses a MODIFIED against a spec that
  is not there, so this is written as ADDED and archives on its own.

  Nothing here supersedes an earlier requirement — the switch is new.
-->

## Purpose

What a single-product campaign landing page is: the content a merchant authors on it, the offer mechanics it can carry, how it is themed and paid for, and how the storefront renders it as a chrome-free document built to convert ad traffic.

## ADDED Requirements

### Requirement: A campaign can require payment in advance
A landing page SHALL carry its own switch for whether it collects money before the order ships. When on, the page SHALL offer the shopper the same payment choices the shop's own checkout offers and collect the same details.

The switch SHALL be per campaign. One page requiring an advance SHALL NOT affect any other page, nor the shop's own checkout.

A page with the switch off SHALL behave exactly as landing pages did before this capability existed: cash on delivery, nothing collected up front, no payment choice presented.

#### Scenario: Campaign requires an advance
- **WHEN** a visitor opens a campaign whose switch is on
- **THEN** the order form presents the payment choices and asks for the payment details

#### Scenario: Campaign does not
- **WHEN** a visitor opens a campaign whose switch is off
- **THEN** the order form is the unchanged cash-on-delivery form, with no payment choice

#### Scenario: Two campaigns, one switch each
- **GIVEN** two published campaigns, one requiring an advance and one not
- **WHEN** a visitor opens each in turn
- **THEN** each behaves according to its own switch

#### Scenario: The shop's checkout is unaffected
- **WHEN** a campaign's switch is turned on
- **THEN** the shop's own checkout behaves exactly as its own settings say, unchanged

### Requirement: The accounts are the shop's, never the campaign's
The accounts a shopper sends money to SHALL be the ones configured for the shop as a whole. A landing page SHALL decide only WHETHER to ask for an advance, never where the money goes.

A campaign SHALL NOT be able to declare payment accounts of its own.

Changing a shop-wide account SHALL take effect on every campaign that asks for an advance, without any campaign being edited.

#### Scenario: Merchant changes a number
- **WHEN** the merchant changes their bKash number in the shop's settings
- **THEN** every campaign asking for an advance shows the new number, with no campaign edited

#### Scenario: Campaign attempts its own accounts
- **WHEN** a merchant tries to save payment accounts on a landing page
- **THEN** no such field is accepted — the accounts are the shop's

### Requirement: A campaign cannot ask for money with nowhere to send it
The switch SHALL NOT be turnable on while the shop has advance payment disabled, or while it has configured no account. The refusal SHALL name what is missing and where it is configured.

#### Scenario: Shop has no accounts
- **WHEN** a merchant turns the switch on while the shop has configured no payment account
- **THEN** the save is refused, naming the missing accounts and where to add them, and the switch stays off

#### Scenario: Shop has advance payment disabled
- **WHEN** a merchant turns the switch on while the shop's own advance payment is off
- **THEN** the save is refused on the same grounds

#### Scenario: Accounts are removed after a campaign is live
- **GIVEN** a published campaign asking for an advance
- **WHEN** the merchant removes every shop-wide account
- **THEN** the campaign stops asking for an advance rather than asking with nothing to show, and orders continue as cash on delivery
