## MODIFIED Requirements

### Requirement: Admins can manage the full catalog
An authenticated OWNER/ADMIN SHALL be able to create, read, update, and delete `Category`, `Brand`, and `Product` records, including a product's nested `ProductVariant`, `ProductAttribute`, `ProductImage`, and supplementary `ProductCategory` tags. Product create and update SHALL additionally accept `multipart/form-data` requests carrying one or more image files, which are uploaded and attached as `ProductImage` rows alongside (or instead of) URL-based image entries, in the same request that creates or updates the product.

#### Scenario: Admin creates a product with variants
- **WHEN** an ADMIN submits a new product with one or more variants
- **THEN** the `Product` and its `ProductVariant` rows are created together
- **AND** the response includes the created product with its variants

#### Scenario: Non-admin cannot modify the catalog
- **WHEN** a request to create/update/delete a category, brand, or product is made without an OWNER/ADMIN session
- **THEN** the request is rejected with 401/403 and no data is changed

#### Scenario: Admin creates a product with multiple uploaded image files
- **WHEN** an ADMIN submits a new product as `multipart/form-data` with two or more image files attached
- **THEN** each file is uploaded and a corresponding `ProductImage` row is created for the product
- **AND** the response includes the created product with all uploaded images among its `images`

#### Scenario: Admin updates a product mixing kept, URL, and uploaded images
- **WHEN** an ADMIN updates an existing product in one request that keeps an existing image by `id`, adds a new image by `url`, and uploads a new image file
- **THEN** the existing image is retained, the URL-based image is created, and the uploaded file is uploaded and created
- **AND** any previously existing image not represented in the request (by `id`) is removed, consistent with how URL-based image sync already behaves

#### Scenario: A file upload fails partway through a multi-file batch
- **WHEN** an ADMIN submits a product create or update with multiple image files and one file fails to upload
- **THEN** the request fails and no product data is created or modified
- **AND** no partially-created `ProductImage` rows exist for that request

#### Scenario: Plain JSON product create/update is unaffected
- **WHEN** an ADMIN submits a product create or update as `application/json` with no files, exactly as before this change
- **THEN** the request behaves identically to before this change, with `images` accepted only as URL-based entries
