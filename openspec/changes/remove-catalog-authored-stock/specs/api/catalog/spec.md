## MODIFIED Requirements

### Requirement: Admins can manage the full catalog
An authenticated OWNER/ADMIN SHALL be able to create, read, update, and delete `Category`, `Brand`, and `Product` records, including a product's nested `ProductVariant`, `ProductAttribute`, `ProductImage`, and supplementary `ProductCategory` tags.

Catalog management SHALL NOT set stock quantities. Neither product create/update nor variant create/update SHALL accept a stock quantity at the product or variant level; a submitted one SHALL be ignored rather than applied, and no request through the catalog SHALL change `Product.stockQuantity`, `ProductVariant.stockQuantity`, or any `Stock` row. Stock is owned by the inventory capability and moves only via a `StockMovement` — see `api/inventory`.

A product's low-stock threshold remains catalog-managed. It states when to warn, not how many exist, and no inventory movement determines it.

#### Scenario: Admin creates a product with variants
- **WHEN** an ADMIN submits a new product with one or more variants
- **THEN** the `Product` and its `ProductVariant` rows are created together
- **AND** the response includes the created product with its variants

#### Scenario: Non-admin cannot modify the catalog
- **WHEN** a request to create/update/delete a category, brand, or product is made without an OWNER/ADMIN session
- **THEN** the request is rejected with 401/403 and no data is changed

#### Scenario: A newly created product holds no stock
- **WHEN** an ADMIN creates a product, with or without variants
- **THEN** the product and every variant report a stock quantity of 0
- **AND** no `Stock` row and no `StockMovement` is created for it
- **AND** the product is not sellable until stock is received against it through the inventory capability

#### Scenario: A submitted stock quantity is not applied
- **WHEN** a product create or update request includes a stock quantity, at the product level or on a nested variant
- **THEN** the request succeeds and the value is discarded
- **AND** the stored stock quantities are unchanged, still reflecting only what the `Stock` ledger holds

#### Scenario: Editing a product does not disturb stock it already holds
- **WHEN** an ADMIN updates a product that already holds stock — renaming it, repricing it, or editing its variants
- **THEN** the product's and each surviving variant's stock quantities are unchanged
- **AND** no `StockMovement` is created, because no stock moved

#### Scenario: Admin sets the low stock threshold
- **WHEN** an ADMIN sets a product's low stock threshold
- **THEN** the threshold is stored on the product
- **AND** the product's stock quantity is unaffected
