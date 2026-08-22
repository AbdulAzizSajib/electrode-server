## Purpose

Lets a product be discoverable from more than one category listing page, in addition to the single primary category it already has, without disrupting any existing single-category behavior.

## ADDED Requirements

### Requirement: A product may be tagged into additional categories beyond its primary category
The system SHALL allow a `Product` to be associated with zero or more additional `Category` records via a many-to-many relationship, independent of and in addition to its existing single primary `category` relation.

#### Scenario: Product exists in only its primary category
- **WHEN** a product has never been tagged into any additional category
- **THEN** it is still discoverable via its existing primary `category` relation exactly as before this change — no existing behavior regresses

#### Scenario: Product is tagged into a second category
- **WHEN** an admin adds a product to an additional category beyond its primary one
- **THEN** the product becomes listable under both its primary category and every additional category it was tagged into

#### Scenario: Removing an additional category tag doesn't affect the primary category
- **WHEN** an admin removes one of a product's additional category tags
- **THEN** the product's primary `category` relation is unaffected
- **AND** the product remains listed under its primary category and any other additional categories still tagged

### Requirement: A product is not tagged into the same additional category twice
The many-to-many product-category association SHALL NOT allow duplicate entries for the same product/category pair.

#### Scenario: Tagging the same category twice is a no-op
- **WHEN** an admin attempts to tag a product into an additional category it is already tagged into
- **THEN** no duplicate association is created
