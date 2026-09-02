## Purpose

Enables linking product images to specific variants so shoppers see the correct variant image when selecting options like color or size.

## ADDED Requirements

### Requirement: Product images can be linked to variants
The system SHALL allow each `ProductImage` to be optionally associated with a `ProductVariant` via `variantId`. An image with no `variantId` SHALL be treated as a product-level image.

#### Scenario: Image linked to variant on create
- **WHEN** an ADMIN creates a product with variants and assigns images to specific variants
- **THEN** each image's `variantId` is stored with the product image
- **AND** images without `variantId` remain as product-level images

#### Scenario: Image linked to variant on update
- **WHEN** an ADMIN updates an existing product and assigns images to variants
- **THEN** the images' `variantId` values are updated to match the specified variants

#### Scenario: Variant deletion preserves linked images
- **WHEN** a variant that has linked images is deleted
- **THEN** the linked images survive with `variantId` set to `null`
- **AND** the images remain accessible through the product detail response
