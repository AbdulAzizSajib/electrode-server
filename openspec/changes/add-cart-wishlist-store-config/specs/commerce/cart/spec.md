## Purpose

Gives every shopper — logged in or not — a persistent cart that survives across requests, devices (once logged in), and the login/registration moment, instead of relying solely on client-side state.

## ADDED Requirements

### Requirement: A cart is identified by customer or guest token, never both loosely
Every `Cart` SHALL be addressable by exactly one of: a `customerId` (logged-in shopper) or a `guestToken` (not logged in). A cart SHALL NOT exist with both null.

#### Scenario: Guest starts a cart
- **WHEN** a not-logged-in visitor adds a product to their cart for the first time
- **THEN** a `Cart` row is created with a `guestToken` and no `customerId`

#### Scenario: Logged-in customer starts a cart
- **WHEN** a logged-in customer adds a product to their cart for the first time
- **THEN** a `Cart` row is created with their `customerId` and no `guestToken`

#### Scenario: A customer has at most one cart
- **WHEN** a customer already has a `Cart` row and adds another product
- **THEN** the existing `Cart` is reused (a `Customer` never has more than one `Cart` at a time)

### Requirement: Guest cart merges into the customer's cart on login
When a shopper with an active guest cart logs in or registers, their guest cart's items SHALL be merged into their customer cart (creating one if none exists), and the guest cart SHALL stop being reachable by its former guest token afterward.

#### Scenario: Guest logs in with no prior customer cart
- **WHEN** a guest with items in their guest cart logs into an account that has no existing cart
- **THEN** the guest cart is promoted to that customer's cart (all items preserved)

#### Scenario: Guest logs in with an existing customer cart
- **WHEN** a guest with items in their guest cart logs into an account that already has a cart with items
- **THEN** the guest cart's items are merged into the existing customer cart
- **AND** if the same product/variant appears in both, the quantities are combined rather than duplicated

### Requirement: A cart line item tracks its exact product/variant and quantity
Each `CartItem` SHALL reference exactly one `Product` (and optionally the specific `ProductVariant` chosen) and a quantity, with at most one line item per distinct product/variant combination within a cart.

#### Scenario: Adding the same product/variant twice increments quantity
- **WHEN** a shopper adds a product/variant combination that is already in their cart
- **THEN** the existing `CartItem`'s quantity increases rather than a duplicate row being created
