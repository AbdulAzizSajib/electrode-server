## MODIFIED Requirements

### Requirement: Admins can manage the full catalog
An authenticated OWNER/ADMIN SHALL be able to create, read, update, and delete `Category`, `Brand`, and `Product` records, including a product's nested `ProductVariant`, `ProductAttribute`, `ProductImage`, and supplementary `ProductCategory` tags. Product create and update SHALL additionally accept `multipart/form-data` requests carrying one or more image files, which are uploaded and attached as `ProductImage` rows alongside (or instead of) URL-based image entries, in the same request that creates or updates the product.

Each product image SHALL be associable with at most one of that product's variants. An image with no variant association is shared by the whole product and applies to every variant. The association SHALL be expressible in the same request that creates the variant, including when the variant does not yet exist and therefore has no id, and SHALL be expressible for uploaded files as well as for URL-based image entries. A product image SHALL never be associated with a variant of a different product.

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

#### Scenario: Admin creates a product assigning images to variants that do not yet exist
- **WHEN** an ADMIN submits a new product carrying two variants and several images, where each image identifies its variant by that variant's position in the submitted `variants` list and some images identify no variant at all
- **THEN** the variants are created and each such image is stored associated with the variant that occupied the position it named
- **AND** images that named no variant are stored with no variant association
- **AND** the response includes, for every image, the variant it is associated with or an explicit absence of one

#### Scenario: Admin assigns an uploaded file to a variant in the same request
- **WHEN** an ADMIN submits a product create or update as `multipart/form-data` where the metadata describing an uploaded file names a variant of that product
- **THEN** the uploaded file is stored as an image associated with that variant
- **AND** the association is expressible both for a variant that already exists and for one being created in the same request

#### Scenario: Admin reassigns an existing image to a different variant
- **WHEN** an ADMIN updates a product, resubmitting an existing image by `id` with a different variant named than it currently has
- **THEN** the image's variant association is changed to the named variant, with no other image or variant affected
- **AND** resubmitting the same image with no variant named clears its association, making it shared across all variants

#### Scenario: Image names a variant that is not the product's
- **WHEN** an ADMIN submits a product create or update in which an image names a variant belonging to a different product, or names a variant position that does not exist in the submitted `variants` list
- **THEN** the request is rejected with 400 and an error identifying the offending image
- **AND** no product, variant, or image data is created or modified

#### Scenario: Removing a variant preserves its images
- **WHEN** an ADMIN updates a product so that a variant which has images associated with it is no longer present in the submitted `variants` list
- **THEN** the variant is removed
- **AND** its images are retained as images of the product with no variant association, rather than being deleted

### Requirement: The public can browse and search the catalog without authentication
Anonymous requests SHALL be able to list and filter products (by category, brand, price range, search term) and view a single product's full detail (including variants, images, and reviews summary), without any session.

A public product detail response SHALL report, for each of the product's images, which variant that image is associated with, or that it is associated with none. This is what allows a storefront to show only the images relevant to the option a shopper has selected, and to resolve a selected image back to the variant it depicts.

#### Scenario: Anonymous product listing
- **WHEN** an unauthenticated request lists products with a category filter
- **THEN** only `ACTIVE`-status products in that category (or its supplementary `ProductCategory` tags) are returned, paginated

#### Scenario: Draft/archived products are not publicly visible
- **WHEN** an unauthenticated request fetches a product that is `DRAFT` or `ARCHIVED`
- **THEN** the response is a 404, not the product data (admins can still fetch it via the admin endpoint)

#### Scenario: Public product detail reports each image's variant
- **WHEN** an unauthenticated request fetches an `ACTIVE` product whose images are associated with its variants
- **THEN** every image in the response carries the identity of its associated variant, or an explicit absence of one for shared images
- **AND** the variant identities reported are ids of variants present in the same response, so the two can be matched without a further request

#### Scenario: Products predating image-to-variant association stay valid
- **WHEN** an unauthenticated request fetches a product whose images were created before any variant association existed
- **THEN** the product is returned with every image reported as having no variant association
- **AND** the response is otherwise identical to what it was before this change
