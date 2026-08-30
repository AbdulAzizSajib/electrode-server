## ADDED Requirements

### Requirement: A customer can check and remove wishlist entries by product

An authenticated customer SHALL be able to determine whether a given product is in their wishlist, and remove it, addressing the product directly — without first retrieving their whole wishlist to discover the corresponding entry identifier.

#### Scenario: Checking a product that is in the wishlist

- **WHEN** an authenticated customer checks a product they have saved
- **THEN** the response reports the product as present in their wishlist

#### Scenario: Checking a product that is not in the wishlist

- **WHEN** an authenticated customer checks a product they have not saved
- **THEN** the response is 200 and reports the product as absent, rather than 404

#### Scenario: Removing a saved product by product

- **WHEN** an authenticated customer removes a product they have saved, addressing it by product
- **THEN** the entry is removed from their wishlist

#### Scenario: Removing a product that was never saved

- **WHEN** an authenticated customer removes a product that is not in their wishlist
- **THEN** the response is 404 and no other customer's wishlist is affected

#### Scenario: Product-scoped wishlist operations require authentication

- **WHEN** an unauthenticated request checks or removes a wishlist entry by product
- **THEN** the request is rejected with 401, consistent with every other wishlist operation

### Requirement: A customer can retrieve their wishlist size independently of its contents

An authenticated customer SHALL be able to retrieve the number of items in their wishlist without transferring the items themselves, so a storefront can display a badge count on every page without fetching the full list.

#### Scenario: Reading the wishlist count

- **WHEN** an authenticated customer requests their wishlist count
- **THEN** the response reports the number of their wishlist entries that reference an `ACTIVE` product, without including the entries

#### Scenario: Count for an empty wishlist

- **WHEN** an authenticated customer with no saved products requests their wishlist count
- **THEN** the response is 200 with a count of zero

### Requirement: A customer can move a wishlist item into their cart atomically

An authenticated customer SHALL be able to move a saved product into their cart as a single operation that both adds the cart item and removes the wishlist entry. The operation SHALL be atomic: it SHALL NOT leave the product both in the cart and in the wishlist, nor remove it from the wishlist without adding it to the cart.

#### Scenario: Moving a saved product to the cart

- **WHEN** an authenticated customer moves a wishlist item to their cart
- **THEN** the product is added to their cart and the wishlist entry is removed
- **AND** the response reflects the resulting cart

#### Scenario: Moving a product already present in the cart

- **WHEN** an authenticated customer moves a wishlist item for a product already in their cart
- **THEN** the existing cart item's quantity is incremented rather than a duplicate row being created, and the wishlist entry is removed

#### Scenario: The cart addition fails

- **WHEN** moving a wishlist item to the cart fails because the product cannot be added
- **THEN** the wishlist entry remains in place and no partial change is persisted

#### Scenario: Moving another customer's wishlist item

- **WHEN** an authenticated customer attempts to move a wishlist entry that belongs to a different customer
- **THEN** the request is rejected with 404 and neither customer's wishlist or cart is changed

## MODIFIED Requirements

### Requirement: Wishlist requires authentication, cart does not

A wishlist operation without a customer session SHALL be rejected; a cart operation without one SHALL fall back to guest-cart behavior instead of failing. A customer's wishlist listing SHALL be paginated and SHALL only surface entries whose product is publicly visible, matching the public catalog's `ACTIVE`-only rule, so that a wishlist never advertises a product a shopper cannot buy.

#### Scenario: Guest attempts to save to wishlist

- **WHEN** an unauthenticated request tries to add a product to a wishlist
- **THEN** the request is rejected (401), with no guest wishlist created — per `commerce/wishlist` spec

#### Scenario: Listing a large wishlist

- **WHEN** an authenticated customer lists a wishlist containing more entries than one page
- **THEN** only that page of entries is returned, together with pagination metadata describing the total

#### Scenario: A saved product is archived

- **WHEN** a product saved in a customer's wishlist ceases to be `ACTIVE`
- **THEN** it no longer appears in that customer's wishlist listing or count

#### Scenario: Saving the same product twice concurrently

- **WHEN** two concurrent requests add the same product to the same customer's wishlist
- **THEN** exactly one wishlist entry exists for that product, and the losing request is rejected with 409 rather than an unhandled error
