## ADDED Requirements

### Requirement: The public product listing can be queried by merchandising intent
The public product listing SHALL let an anonymous caller retrieve products by the merchandising meaning of a storefront section, not only by catalog attributes. It SHALL support restricting results to products flagged as featured, and ordering results by the number of units sold. Both operate on `ACTIVE` products only, and compose with the existing category, brand, price-range, search, and pagination parameters.

Units sold SHALL count only sales whose payment has succeeded. A placed but unpaid order — including a cash-on-delivery order awaiting collection — SHALL NOT contribute, and a sale whose payment is later refunded or cancelled SHALL stop contributing.

#### Scenario: Listing only featured products
- **WHEN** an unauthenticated request lists products filtered to featured
- **THEN** only `ACTIVE` products flagged as featured are returned, paginated
- **AND** a product that is featured but `DRAFT` or `ARCHIVED` is not among them

#### Scenario: Ordering by units sold
- **WHEN** an unauthenticated request lists products ordered by units sold, descending
- **THEN** the product with the most units sold appears first
- **AND** products that have never sold appear last, reported as zero rather than as absent or null

#### Scenario: An unpaid order does not count as a sale
- **WHEN** an order is placed and its payment has not succeeded
- **THEN** the ordered products' units-sold figures are unchanged

#### Scenario: Payment succeeds
- **WHEN** an order's payment reaches a paid state
- **THEN** each ordered product's units-sold figure increases by the quantity ordered

#### Scenario: A paid sale is refunded
- **WHEN** a payment that had previously succeeded moves to refunded or cancelled
- **THEN** each ordered product's units-sold figure decreases by the quantity ordered
- **AND** no product's units-sold figure becomes negative

#### Scenario: Merchandising filters compose with catalog filters
- **WHEN** an unauthenticated request lists featured products within one category
- **THEN** only `ACTIVE`, featured products in that category (or its supplementary tags) are returned

### Requirement: Public product ordering is restricted to an allowlist of fields
The public product listing SHALL accept an ordering field only from a defined allowlist of fields that are already part of the public product representation. A request naming any other field SHALL be rejected with a validation error identifying the parameter, and SHALL NOT fall back to a default ordering — silently ignoring the field would let a caller believe the results are ordered when they are not.

This constraint applies to the public listing only. The authenticated admin listing is unaffected, since an admin is already entitled to every product column.

#### Scenario: Ordering by a non-public column is rejected
- **WHEN** an unauthenticated request asks the public product listing to order by a column that is not publicly readable, such as supplier cost
- **THEN** the request is rejected with a 400 naming the ordering parameter
- **AND** no product data is returned, so the relative ordering of that column is not disclosed

#### Scenario: Ordering by an allowed field succeeds
- **WHEN** an unauthenticated request orders the public listing by an allowlisted field
- **THEN** the results are returned in that order

#### Scenario: Omitted ordering falls back to the default
- **WHEN** an unauthenticated request specifies no ordering field
- **THEN** the listing applies its default ordering and succeeds
