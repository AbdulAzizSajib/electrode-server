## Purpose

Lets a logged-in customer save products they're interested in for later, separate from their cart.

## ADDED Requirements

### Requirement: Wishlist requires a customer account
Every `Wishlist` SHALL belong to exactly one `Customer`, with at most one `Wishlist` per `Customer`. There is no guest wishlist (unlike cart).

#### Scenario: Customer saves a product for the first time
- **WHEN** a logged-in customer saves a product to their wishlist and has no existing `Wishlist` row
- **THEN** a `Wishlist` is created for that customer and the product is added as a `WishlistItem`

#### Scenario: Guest attempts to use the wishlist
- **WHEN** a not-logged-in visitor attempts to save a product to a wishlist
- **THEN** the system requires authentication first (no anonymous wishlist is created)

### Requirement: A product appears at most once per wishlist
Each `WishlistItem` SHALL reference exactly one `Product`, with no duplicate product entries within the same `Wishlist`.

#### Scenario: Saving an already-saved product is a no-op duplicate-safe action
- **WHEN** a customer saves a product that is already in their wishlist
- **THEN** no duplicate `WishlistItem` is created
