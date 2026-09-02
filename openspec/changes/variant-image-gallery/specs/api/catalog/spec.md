## MODIFIED Requirements

### Requirement: Admins can manage the full catalog
An authenticated OWNER/ADMIN SHALL be able to create, read, update, and delete `Category`, `Brand`, and `Product` records, including a product's nested `ProductVariant`, `ProductAttribute`, `ProductImage`, and supplementary `ProductCategory` tags.

#### Scenario: Admin creates a product with variants
- **WHEN** an ADMIN submits a new product with one or more variants
- **THEN** the `Product` and its `ProductVariant` rows are created together
- **AND** the response includes the created product with its variants
- **AND** variant-level images may be assigned to each variant during creation

#### Scenario: Admin assigns images to variants
- **WHEN** an ADMIN creates or updates a product with variant-level images
- **THEN** each image's `variantId` is recorded against the specified variant
- **AND** images without a `variantId` remain as product-level images

#### Scenario: Non-admin cannot modify the catalog
- **WHEN** a request to create/update/delete a category, brand, or product is made without an OWNER/ADMIN session
- **THEN** the request is rejected with 401/403 and no data is changed

### Requirement: The public can browse and search the catalog without authentication
Anonymous requests SHALL be able to list and filter products (by category, brand, price range, search term) and view a single product's full detail (including variants, images, and reviews summary), without any session.

#### Scenario: Anonymous product listing
- **WHEN** an unauthenticated request lists products with a category filter
- **THEN** only `ACTIVE`-status products in that category (or its supplementary `ProductCategory` tags) are returned, paginated

#### Scenario: Product detail includes variant-linked images
- **WHEN** an unauthenticated request fetches a single product's detail
- **THEN** the response includes all product images with their `variantId` values
- **AND** the response includes the product's variants with their linked images

#### Scenario: Draft/archived products are not publicly visible
- **WHEN** an unauthenticated request fetches a product that is `DRAFT` or `ARCHIVED`
- **THEN** the response is a 404, not the product data (admins can still fetch it via the admin endpoint)

### Requirement: Category and brand slugs are stable, unique lookup keys
Public single-item lookups SHALL be addressable by `slug`, not just internal `id`.

#### Scenario: Product lookup by slug
- **WHEN** a shopper requests `GET /products/{slug}`
- **THEN** the matching `ACTIVE` product is returned by its unique `slug`, independent of its `id`
