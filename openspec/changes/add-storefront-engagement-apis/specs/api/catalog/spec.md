## ADDED Requirements

### Requirement: Shoppers can retrieve products related to a given product

An anonymous request SHALL be able to retrieve a list of products related to a given product, addressed by that product's slug. Relatedness SHALL be derived from the catalog's own structure — shared categorization, shared brand, and price proximity — with shared primary category weighted most heavily, followed by shared brand. The source product SHALL never appear in its own related list, and only `ACTIVE` products SHALL be returned.

#### Scenario: Related products for a product with catalog neighbours

- **WHEN** an unauthenticated request asks for products related to an `ACTIVE` product that shares its category with other `ACTIVE` products
- **THEN** those category-sharing products are returned, ordered so that closer matches (same category, then same brand) rank above weaker ones
- **AND** the source product itself is not among them

#### Scenario: Related products for an isolated product

- **WHEN** an unauthenticated request asks for products related to a product that shares no category, brand, or comparable price band with any other product
- **THEN** the response is still 200 with a non-empty list drawn from the wider `ACTIVE` catalog, rather than an empty list

#### Scenario: Non-active products are excluded from related results

- **WHEN** a product's closest catalog neighbour by category and brand is `DRAFT` or `ARCHIVED`
- **THEN** that neighbour does not appear in the related list

#### Scenario: Related products requested for an unknown or non-public product

- **WHEN** an unauthenticated request asks for related products using a slug that matches no product, or matches a `DRAFT`/`ARCHIVED` product
- **THEN** the response is 404

#### Scenario: The caller bounds the result size

- **WHEN** an unauthenticated request asks for related products with an explicit limit
- **THEN** no more than that many products are returned, and the limit is clamped to a documented maximum so an oversized request cannot force an unbounded response

## MODIFIED Requirements

### Requirement: The public can browse and search the catalog without authentication

Anonymous requests SHALL be able to list and filter products (by category, brand, price range, search term) and view a single product's full detail (including variants, images, and reviews summary), without any session. A product's reviews summary SHALL be an aggregate of its `APPROVED` reviews — an average rating and a review count — and SHALL be present on both public list and public detail responses so a storefront can render a rating without issuing a second request.

#### Scenario: Anonymous product listing

- **WHEN** an unauthenticated request lists products with a category filter
- **THEN** only `ACTIVE`-status products in that category (or its supplementary `ProductCategory` tags) are returned, paginated

#### Scenario: Draft/archived products are not publicly visible

- **WHEN** an unauthenticated request fetches a product that is `DRAFT` or `ARCHIVED`
- **THEN** the response is a 404, not the product data (admins can still fetch it via the admin endpoint)

#### Scenario: Listed products carry their rating aggregate

- **WHEN** an unauthenticated request lists products
- **THEN** every returned product includes its average rating and its review count

#### Scenario: A product with no approved reviews

- **WHEN** an unauthenticated request fetches a product that has no `APPROVED` reviews
- **THEN** the product is returned with a review count of zero and an average rating of zero, not a null or absent field

#### Scenario: Shoppers can order results by rating

- **WHEN** an unauthenticated request lists products sorted by average rating
- **THEN** the results are ordered by that aggregate
