## ADDED Requirements

### Requirement: A product's three prices are named for what they mean
Every product and every product variant SHALL express its money fields as `purchasePrice` (what the merchant paid a supplier), `sellingPrice` (the regular price, presented struck through when an offer is running) and `offerPrice` (the amount actually charged to the shopper). These names SHALL be used consistently in API request bodies, API responses, and admin-facing labels, so that the field a merchant fills in matches the words they use for it.

`offerPrice` SHALL be required on a product. `sellingPrice` and `purchasePrice` SHALL be optional: a product sold at its regular price with no offer has no separate selling price to strike through, and a product whose supplier cost was never recorded still sells. On a variant all three SHALL be optional, an absent value meaning the variant is priced by its parent product.

#### Scenario: Creating a product with the new field names
- **WHEN** an ADMIN creates a product supplying `purchasePrice`, `sellingPrice` and `offerPrice`
- **THEN** the product is created with those three values
- **AND** the response carries them back under the same three names

#### Scenario: Offer price alone is sufficient
- **WHEN** an ADMIN creates a product supplying only `offerPrice`
- **THEN** the product is created
- **AND** `sellingPrice` and `purchasePrice` are absent rather than defaulted to zero

#### Scenario: A shopper is charged the offer price
- **WHEN** a shopper adds a product to the cart and checks out
- **THEN** the line is priced from `offerPrice`, not from `sellingPrice`

#### Scenario: A variant without prices inherits from its product
- **WHEN** a product's variant is created with no `offerPrice`
- **THEN** the variant is sold at its parent product's `offerPrice`

### Requirement: The three prices must be mutually consistent
The system SHALL reject a product or variant whose prices contradict each other. `sellingPrice`, when present, MUST be greater than or equal to `offerPrice` — a regular price below the offer price would render as a strike-through cheaper than the live price. `offerPrice` MUST be greater than `purchasePrice` when a purchase price is present, since a catalogue price at or below supplier cost is a loss the merchant did not ask for. All three MUST be non-negative.

Rejection SHALL name which pair is inconsistent, so the merchant can tell which of the two fields to correct.

#### Scenario: Regular price below the offer price is rejected
- **WHEN** an ADMIN submits a product with `sellingPrice` 900 and `offerPrice` 1000
- **THEN** the request is rejected with a validation error identifying `sellingPrice` and `offerPrice`
- **AND** no product is created or modified

#### Scenario: Selling below supplier cost is rejected
- **WHEN** an ADMIN submits a product with `purchasePrice` 1000 and `offerPrice` 900
- **THEN** the request is rejected with a validation error identifying `purchasePrice` and `offerPrice`

#### Scenario: Equal selling and offer price is accepted
- **WHEN** an ADMIN submits a product with `sellingPrice` 1000 and `offerPrice` 1000
- **THEN** the product is created, since a product with no discount running is not an inconsistency

#### Scenario: Consistency holds on partial update
- **WHEN** an ADMIN updates only `offerPrice`, raising it above the product's stored `sellingPrice`
- **THEN** the request is rejected, the stored `sellingPrice` being compared against even though it was not part of the request

#### Scenario: A variant is validated against its own prices
- **WHEN** an ADMIN submits a variant whose `sellingPrice` is below its own `offerPrice`
- **THEN** the request is rejected for that variant

### Requirement: Supplier cost is never exposed to unauthenticated callers
`purchasePrice` is commercial information about the merchant's margin, not a description of the product. It SHALL NOT appear in any response served to an unauthenticated caller, for either a product or a variant, and SHALL NOT be reachable indirectly by ordering a public listing on it. Only an authenticated OWNER/ADMIN SHALL receive it.

#### Scenario: Public product detail omits supplier cost
- **WHEN** an unauthenticated request fetches a product's detail
- **THEN** the response contains `offerPrice` and `sellingPrice`
- **AND** contains no `purchasePrice`, for the product or for any of its variants

#### Scenario: Public listings cannot be ordered by supplier cost
- **WHEN** an unauthenticated request lists products asking to sort by `purchasePrice`
- **THEN** the request is rejected as a bad request
- **AND** no listing is returned, so no ordering can reveal supplier cost

#### Scenario: The permitted sort fields remain available
- **WHEN** an unauthenticated request lists products asking to sort by `offerPrice`
- **THEN** the request is accepted and the listing is ordered by what the shopper would pay

#### Scenario: Admins can read supplier cost
- **WHEN** an authenticated ADMIN fetches a product through the admin endpoint
- **THEN** `purchasePrice` is included

## MODIFIED Requirements

### Requirement: The public can browse and search the catalog without authentication
Anonymous requests SHALL be able to list and filter products (by category, brand, price range, search term) and view a single product's full detail (including variants, images, and reviews summary), without any session. A price-range filter SHALL be understood as filtering on `offerPrice` — the amount a shopper would pay — since that is the price the shopper sees and the one a stated budget refers to.

#### Scenario: Anonymous product listing
- **WHEN** an unauthenticated request lists products with a category filter
- **THEN** only `ACTIVE`-status products in that category (or its supplementary `ProductCategory` tags) are returned, paginated

#### Scenario: Draft/archived products are not publicly visible
- **WHEN** an unauthenticated request fetches a product that is `DRAFT` or `ARCHIVED`
- **THEN** the response is a 404, not the product data (admins can still fetch it via the admin endpoint)

#### Scenario: Price range filters on what the shopper pays
- **WHEN** an unauthenticated request lists products constrained to a maximum price
- **THEN** products are included or excluded by their `offerPrice`
- **AND** a product whose `sellingPrice` exceeds the maximum but whose `offerPrice` falls within it is included
