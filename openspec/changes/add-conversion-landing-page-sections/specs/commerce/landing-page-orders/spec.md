<!--
  NOTE — WHY THESE ARE "ADDED" AND NOT "MODIFIED".

  Two of the requirements below restate an existing one in amended form:
  "The landing page sells one pre-selected product with an adjustable quantity"
  and "An order records which landing page produced it and which zone was
  chosen". Both belong to `add-single-product-landing-page`, which is NOT YET
  ARCHIVED — so `openspec/specs/commerce/landing-page-orders/` does not exist,
  and archive refuses a MODIFIED against a spec that is not there.

  They are written as ADDED so this change can archive on its own. Whichever
  change archives SECOND must reconcile the pair: the versions here supersede
  the originals, because they are the ones that account for packages.

  If `add-single-product-landing-page` is archived first, convert these two back
  to MODIFIED against the spec it creates.
-->

## Purpose

How an order placed from a campaign landing page is priced, validated and recorded — a cash-on-delivery guest order that bypasses the cart and carries the page and package it came from.

## ADDED Requirements

### Requirement: A landing page order names the package it was placed for
Where a landing page offers packages, an order placed from it SHALL record which package was chosen, and the price SHALL be resolved from that package by the SERVER. A package reference that is not one of the page's own packages SHALL be refused.

The recorded package SHALL survive the merchant later editing or removing it, in the same way the page's own title is captured onto the order — an order whose package no longer exists must still say what was sold.

#### Scenario: Order for the larger package
- **WHEN** a visitor selects the ১ কেজি package and submits the form
- **THEN** the order is for that package's product at that package's price
- **AND** the order records which package it was

#### Scenario: Client names a package the page does not offer
- **WHEN** an order arrives naming a package that is not on that page
- **THEN** it is refused, and no order is created

#### Scenario: Client names its own price
- **WHEN** an order arrives carrying a price that differs from the selected package's
- **THEN** it is refused rather than honoured

#### Scenario: Merchant removes a package that has orders
- **WHEN** a merchant deletes a package that has produced orders
- **THEN** those orders are retained and each still states which package it was placed for

#### Scenario: Page with no packages
- **WHEN** an order is placed from a page that declares no packages
- **THEN** it is priced from the bound product exactly as before, and names no package

<!-- These two supersede same-named requirements in add-single-product-landing-page; see the note above. -->


### Requirement: The landing page sells one pre-selected product with an adjustable quantity

The system SHALL present the landing page's product as already chosen, with a quantity control defaulting to 1. Where the page offers PACKAGES, the selected package decides which product and which price — the shopper picks one package, never several, and never a cart. Where it offers none, the page's bound product is used, as before.

The shopper SHALL NOT have to add anything to a cart, open a cart, or navigate to a checkout page in order to buy. Adjusting the quantity SHALL update the displayed totals.

#### Scenario: Visitor orders the default quantity

- **WHEN** a visitor fills in the order form and submits without touching the quantity
- **THEN** an order is placed for one unit of the selected package, or of the bound product when the page has no packages

#### Scenario: Visitor increases the quantity

- **WHEN** a visitor raises the quantity to 3
- **THEN** the displayed item total, delivery charge and grand total update to reflect three units
- **AND** submitting places an order for three units

#### Scenario: Visitor lowers the quantity below one

- **WHEN** a visitor tries to reduce the quantity below 1
- **THEN** the quantity stays at 1

#### Scenario: Quantity applies to the selected package

- **WHEN** a visitor selects the ১ কেজি package and raises the quantity to 2
- **THEN** the totals reflect two units of that package, not of any other

#### Scenario: Landing page order leaves the shopper's cart alone

- **GIVEN** a visitor with two products already in their cart
- **WHEN** they place an order from a landing page
- **THEN** the order contains only the landing page's product
- **AND** their cart still holds the same two products afterwards

### Requirement: An order records which landing page produced it and which zone was chosen

The system SHALL record on every landing page order the landing page it came from, the delivery zone the shopper selected, and — where the page offers packages — which package was bought. The admin panel SHALL show, for each landing page, how many orders and how much revenue it has produced, and SHALL show on each order which landing page it came from, which delivery area was chosen, and which package was sold.

Per-package figures SHALL be derivable, because a merchant running a two-tier offer needs to know which tier the money came from in order to decide what to advertise next.

#### Scenario: Merchant reviews an order

- **WHEN** a merchant opens an order placed from a landing page
- **THEN** the order detail names the landing page it came from
- **AND** it shows the delivery area the shopper selected
- **AND** it shows which package was bought, when the page offered any

#### Scenario: Merchant compares two campaigns

- **GIVEN** two published landing pages for the same product
- **WHEN** the merchant opens the Landing Pages list
- **THEN** each page shows its own order count and revenue

#### Scenario: Merchant compares two packages on one page

- **GIVEN** a page offering two packages, both with orders
- **WHEN** the merchant reviews that page's performance
- **THEN** the orders and revenue attributable to each package are distinguishable

#### Scenario: Merchant deletes a landing page that has orders

- **WHEN** a merchant deletes a landing page that has produced orders
- **THEN** the orders are retained
- **AND** each still records the name of the landing page it came from

#### Scenario: An order from the normal checkout

- **WHEN** a merchant opens an order placed through the normal checkout
- **THEN** no landing page is named on it
