## MODIFIED Requirements

### Requirement: The public can browse and search the catalog without authentication
Anonymous requests SHALL be able to list and filter products (by category, brand, price range, search term) and view a single product's full detail (including variants, images, and reviews summary), without any session.

A public listing's search term SHALL match a product's `name` or `sku` (case-insensitive, substring). It SHALL NOT match `description` or `shortDescription`.

A public listing SHALL return at most 60 products per page. A requested `limit` above 60 SHALL be served as 60 rather than rejected, and the response `meta.limit` SHALL report the limit actually applied.

A public listing row SHALL carry what a product card renders and SHALL NOT carry the product's long `description`. Its embedded `category` and `brand` SHALL be limited to `id`, `name` and `slug`. Product detail SHALL carry `description`; its supplementary categories SHALL likewise be limited to `id`, `name` and `slug`, and its tags to `id` and `name` (tags have no slug).

#### Scenario: Anonymous product listing
- **WHEN** an unauthenticated request lists products with a category filter
- **THEN** only `ACTIVE`-status products in that category (or its supplementary `ProductCategory` tags) are returned, paginated

#### Scenario: Draft/archived products are not publicly visible
- **WHEN** an unauthenticated request fetches a product that is `DRAFT` or `ARCHIVED`
- **THEN** the response is a 404, not the product data (admins can still fetch it via the admin endpoint)

#### Scenario: Search matches name and SKU
- **WHEN** an unauthenticated request lists products with `searchTerm=buds`
- **THEN** products whose `name` or `sku` contains "buds" in any letter case are returned
- **AND** a product whose only mention of "buds" is in its description is not returned

#### Scenario: Oversized page request is clamped
- **WHEN** an unauthenticated request lists products with `limit=1000`
- **THEN** at most 60 products are returned and `meta.limit` is 60

#### Scenario: List rows omit the long description
- **WHEN** an unauthenticated request lists products
- **THEN** no row contains a `description` field
- **AND** each row's `category` and `brand`, when present, contain only `id`, `name` and `slug`

#### Scenario: Detail still carries the description
- **WHEN** an unauthenticated request fetches `GET /products/{slug}` for an `ACTIVE` product
- **THEN** the response includes the product's `description`
