## Purpose

Turns the `Cart`/`CartItem`/`Wishlist`/`WishlistItem` schema (added in `add-cart-wishlist-store-config`) into working API behavior for guests and logged-in customers, and exposes `CustomerAddress` management.

## ADDED Requirements

### Requirement: A guest can build a cart without an account
An unauthenticated request SHALL be able to create/read/update a cart identified by a `guestToken` the API issues and the client persists (cookie), fulfilling the `commerce/cart` spec's guest-cart requirement.

#### Scenario: First add-to-cart from a guest
- **WHEN** a guest with no existing cart adds a product to their cart
- **THEN** a `Cart` row is created with a fresh `guestToken`, returned to the client for persistence
- **AND** the product is added as a `CartItem`

### Requirement: A guest cart merges into the customer cart on login
The login and registration endpoints SHALL merge an active guest cart into the customer's cart, fulfilling the `commerce/cart` spec's merge requirement as working behavior, not just a schema shape.

#### Scenario: Login with an active guest cart
- **WHEN** a shopper with a non-empty guest cart logs in
- **THEN** the guest cart's items are merged into their customer cart (quantities combined on matching product/variant, per `commerce/cart` spec), and the guest cart stops being reachable by its former token

### Requirement: CartItem quantity changes never produce duplicate rows
Adding a product/variant already in the cart SHALL increment the existing `CartItem`, never insert a second row — closing the gap flagged in `docs/database-erd.html`'s Known Gaps (Postgres NULL-distinctness on `variantId`).

#### Scenario: Re-adding a simple (non-variant) product already in the cart
- **WHEN** a shopper adds a product with no variant that is already in their cart
- **THEN** the existing `CartItem` (found via `cartId`+`productId` with `variantId IS NULL`, not the DB unique constraint alone) has its quantity incremented

### Requirement: Wishlist requires authentication, cart does not
A wishlist operation without a customer session SHALL be rejected; a cart operation without one SHALL fall back to guest-cart behavior instead of failing.

#### Scenario: Guest attempts to save to wishlist
- **WHEN** an unauthenticated request tries to add a product to a wishlist
- **THEN** the request is rejected (401), with no guest wishlist created — per `commerce/wishlist` spec

### Requirement: A customer can manage their own shipping/billing addresses
An authenticated customer SHALL be able to create, list, update, delete, and set-default their own `CustomerAddress` records; SHALL NOT be able to read or modify another customer's addresses.

#### Scenario: Setting a new default address
- **WHEN** a customer marks one of their addresses as default
- **THEN** that address becomes their default and any previously-default address for the same `type` is unset
