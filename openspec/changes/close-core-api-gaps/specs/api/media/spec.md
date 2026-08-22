## Purpose

Lets admin/staff upload a file (image) and get back a hosted URL, backing the catalog/marketing admin UIs whose image fields (`Category.image`, `Product.images[].url`, `Banner.image`, etc.) otherwise require an already-hosted URL with no way to produce one.

## ADDED Requirements

### Requirement: Only OWNER/ADMIN/STAFF can upload files
No file-upload endpoint SHALL be reachable by a customer or an unauthenticated request.

#### Scenario: Customer attempts to upload a file
- **WHEN** a customer-role (or unauthenticated) request calls the upload endpoint
- **THEN** the response is 401/403 and no file is stored

### Requirement: An uploaded image is returned as a hosted URL usable by other admin endpoints
Uploading a single image file SHALL store it and return a stable, publicly-fetchable URL, suitable for use as-is in any admin endpoint that accepts an image URL (categories, brands, products, banners).

#### Scenario: Admin uploads a product image
- **WHEN** an OWNER/ADMIN/STAFF uploads an image file to the upload endpoint
- **THEN** the response includes a URL
- **AND** that URL can be submitted as `Product.images[].url` (or any other admin image field) in a subsequent request
