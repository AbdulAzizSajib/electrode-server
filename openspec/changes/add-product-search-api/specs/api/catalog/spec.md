## ADDED Requirements

### Requirement: A dedicated product search endpoint answers suggestions quickly
The API SHALL expose a public, unauthenticated product search endpoint separate from the product listing. It SHALL resolve a query in a single database round trip and return only the fields a suggestion list needs — identity, display name, link target, price, and one image — omitting category, brand, and campaign objects.

#### Scenario: Shopper types a search term
- **WHEN** an unauthenticated request searches for a term matching one or more active products
- **THEN** the matching products are returned with their id, name, slug, price and primary image, and without category, brand or campaign fields

#### Scenario: Term matches nothing
- **WHEN** a search term matches no product by any means, including approximate matching
- **THEN** an empty result set is returned with a success response, not an error

#### Scenario: Empty or missing term
- **WHEN** a search request omits the term or sends only whitespace
- **THEN** the request is rejected as invalid and no search is performed

#### Scenario: Only active products are suggested
- **WHEN** a search term matches a product that is `DRAFT` or `ARCHIVED`
- **THEN** that product does not appear in the results

#### Scenario: Result count is bounded
- **WHEN** a search term matches more products than a suggestion list should display
- **THEN** the number of results returned is capped, and the cap is enforced by the server regardless of what the client requests

### Requirement: Search matches brand name and SKU as well as product text
A search term SHALL be matched against the product's name, SKU and descriptive text, and against the name of the brand it belongs to, so that a shopper who types a brand or a product code finds the corresponding products.

#### Scenario: Shopper searches by brand name
- **WHEN** a shopper searches for a brand's name
- **THEN** active products of that brand are returned, whether or not the brand name appears in their own name

#### Scenario: Shopper searches by SKU
- **WHEN** a shopper searches for a product's SKU
- **THEN** that product is returned

#### Scenario: Search is case-insensitive
- **WHEN** a shopper searches using different capitalisation from how a product is stored
- **THEN** the same products are returned

### Requirement: Search tolerates misspellings
When a term yields no exact matches, the search SHALL fall back to approximate matching so a small spelling error still finds the intended product. Approximate matches SHALL NOT displace exact matches when both exist.

#### Scenario: Shopper misspells a brand
- **WHEN** a shopper searches for a term that is a near-miss of an existing brand or product name and matches nothing exactly
- **THEN** the products that term most closely resembles are returned

#### Scenario: Exact matches are preferred
- **WHEN** a term matches some products exactly and merely resembles others
- **THEN** the exact matches are returned and ranked above any approximate ones

#### Scenario: Unrelated term stays empty
- **WHEN** a term bears no resemblance to any product, brand or SKU
- **THEN** no results are returned rather than distant approximate matches

### Requirement: Search results are ordered by relevance
Results SHALL be ordered by how well each product matches the term — a name matching the term outright ranks above one merely beginning with it, which ranks above one matching only in its description or brand. Recency SHALL NOT determine search ordering.

#### Scenario: Exact name outranks partial match
- **WHEN** a term exactly matches one product's name and appears mid-word or mid-description in others
- **THEN** the exact match is returned first

#### Scenario: Name match outranks description match
- **WHEN** a term appears in one product's name and only in another's description
- **THEN** the product matching by name is ranked higher

#### Scenario: Ties are ordered predictably
- **WHEN** two products match a term equally well
- **THEN** their relative order is stable across identical repeated requests

## MODIFIED Requirements

### Requirement: The public can browse and search the catalog without authentication
Anonymous requests SHALL be able to list and filter products (by category, brand, price range, search term) and view a single product's full detail (including variants, images, and reviews summary), without any session. Product *suggestion* search is served by the dedicated search endpoint described above; the listing endpoint continues to serve full-detail results for a search results page and is unchanged by that addition.

#### Scenario: Anonymous product listing
- **WHEN** an unauthenticated request lists products with a category filter
- **THEN** only `ACTIVE`-status products in that category (or its supplementary `ProductCategory` tags) are returned, paginated

#### Scenario: Draft/archived products are not publicly visible
- **WHEN** an unauthenticated request fetches a product that is `DRAFT` or `ARCHIVED`
- **THEN** the response is a 404, not the product data (admins can still fetch it via the admin endpoint)

#### Scenario: Listing search behaviour is retained
- **WHEN** an unauthenticated request lists products with a search term
- **THEN** it returns the same full-detail, paginated shape it did before the search endpoint existed, including campaign pricing
