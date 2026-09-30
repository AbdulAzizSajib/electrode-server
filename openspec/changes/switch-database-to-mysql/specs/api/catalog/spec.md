## ADDED Requirements

### Requirement: Product search matches on literal substrings, not approximate spelling

The product search endpoint SHALL return a product when the search term appears, ignoring letter case, as a substring of the product's name, SKU, description, or its brand's name. It SHALL NOT return a product that matches only approximately — a misspelled, transposed, or partially-typed word that does not occur literally in any of those four fields is not a match.

Results SHALL be ordered by a relevance score derived from where the term matched, strongest first: an exact name match, then a name prefix match, then a name substring match, then a SKU match, then a brand-name match, then a description match. Products whose highest-scoring match is the same SHALL be ordered by name, so that two identical requests return the same order.

Matching SHALL be case-insensitive for both ASCII and Bangla text, and Bangla search terms SHALL match Bangla product names.

#### Scenario: Correctly spelled partial word matches

- **WHEN** a shopper searches for `wire` and a product is named `Wireless Mouse`
- **THEN** the product is returned, scored as a name-prefix match

#### Scenario: Case is ignored

- **WHEN** a shopper searches for `SAMSUNG` and a brand is stored as `Samsung`
- **THEN** every `ACTIVE` product of that brand is returned

#### Scenario: Bangla term matches a Bangla name

- **WHEN** a shopper searches for a Bangla word that appears in a product's name
- **THEN** that product is returned, and the term is not mangled or rejected by the storage encoding

#### Scenario: A misspelling returns nothing

- **WHEN** a shopper searches for `samsng` and no product name, SKU, description, or brand name contains that literal string
- **THEN** an empty result list is returned, not an approximate match

#### Scenario: Only active products are searchable

- **WHEN** a search term matches a `DRAFT` or `ARCHIVED` product
- **THEN** that product is not included in the results

#### Scenario: An empty term is not a search

- **WHEN** the search term is empty or only whitespace
- **THEN** an empty result list is returned without querying the catalog

### Requirement: Where a duplicate-name check exists, it ignores letter case

Creating or renaming a tag, attribute, attribute value, bundle deal, tax rule, or font family SHALL be rejected when a record with the same name already exists differing only in letter case or in surrounding whitespace. Bulk brand creation SHALL skip such a name with a stated reason rather than creating a second brand.

This requirement fixes the *behavior* of the checks that exist; it does not add one where there is none. Single brand creation has never had a name check — only the bulk path does — and this change does not introduce one, because that would reject names merchants can create today.

#### Scenario: Case-variant duplicate is refused

- **WHEN** an ADMIN creates a tax rule named `standard vat` and one named `Standard VAT` already exists
- **THEN** the request is rejected with a duplicate-name error and no record is created

#### Scenario: Surrounding whitespace does not create a duplicate

- **WHEN** an ADMIN creates a tag named `  Gaming  ` and a tag named `Gaming` already exists
- **THEN** the request is rejected with a duplicate-name error

#### Scenario: Bulk brand creation skips a case variant

- **WHEN** an ADMIN bulk-creates the names `SAMSUNG` and `Sony`, and a brand `Samsung` already exists
- **THEN** `Sony` is created and `SAMSUNG` is returned under `skipped` with a duplicate-name reason

#### Scenario: Single brand creation is unchanged

- **WHEN** an ADMIN creates a brand named `samsung` and a brand named `Samsung` already exists
- **THEN** the brand is created, as it was before this change — the slug is disambiguated, the name is not checked

### Requirement: Merchant-entered long text is stored without truncation

Fields that hold free-form merchant copy — product and category descriptions, SEO and meta descriptions, order and purchase-order notes, cancellation and refund reasons, support message bodies, and stored image or video URLs — SHALL persist the full value the merchant submitted, up to the limit the API's own validation states. Storage SHALL NOT silently shorten a value, and a value within the validated limit SHALL NOT be rejected by the database.

#### Scenario: A long description round-trips intact

- **WHEN** an ADMIN saves a product description of 2,000 characters
- **THEN** the save succeeds and reading the product back returns all 2,000 characters unchanged

#### Scenario: Over-long input is refused by validation, not by the database

- **WHEN** a request submits a value longer than the API's stated limit for that field
- **THEN** the response is a validation error naming the field, not a database error
