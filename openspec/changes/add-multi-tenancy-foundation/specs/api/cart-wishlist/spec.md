## MODIFIED Requirements

### Requirement: A guest can build a cart without an account
An unauthenticated request SHALL be able to create/read/update a cart identified by a `guestToken` the API issues and the client persists (cookie), fulfilling the `commerce/cart` spec's guest-cart requirement. The cart SHALL belong to the resolved tenant, and the issued token SHALL be resolvable only within that tenant.

A `guestToken` SHALL NOT be a platform-wide key. Presenting a token issued by one shop to another shop SHALL yield no cart, exactly as an unrecognised token does — the browser that holds it is the only thing the two shops share, and a token that resolved across them would hand one merchant's cart to another merchant's storefront.

#### Scenario: First add-to-cart from a guest
- **WHEN** a guest with no existing cart adds a product to their cart
- **THEN** a `Cart` row is created for the resolved tenant with a fresh `guestToken`, returned to the client for persistence
- **AND** the product is added as a `CartItem`

#### Scenario: A guest token is presented to a different shop
- **WHEN** a request carrying a `guestToken` issued by shop A is resolved to shop B
- **THEN** no cart is found, and shop B treats the request as a guest with no existing cart

#### Scenario: The same browser shops at two shops
- **WHEN** a guest builds a cart at shop A and then builds a cart at shop B
- **THEN** each shop holds an independent cart, and neither shop's cart contents are visible to the other

### Requirement: A guest cart merges into the customer cart on login
The login and registration endpoints SHALL merge an active guest cart into the customer's cart **within the resolved tenant**, fulfilling the `commerce/cart` spec's merge requirement as working behavior, not just a schema shape.

The customer the guest cart merges into SHALL be resolved within the tenant. A shopper who holds a customer record at several shops SHALL have their guest cart merged only into the record belonging to the shop they logged in at.

#### Scenario: Login with an active guest cart
- **WHEN** a shopper with a non-empty guest cart logs in
- **THEN** the guest cart's items are merged into their customer cart for that tenant (quantities combined on matching product/variant, per `commerce/cart` spec), and the guest cart stops being reachable by its former token

#### Scenario: A shopper with accounts at two shops logs in at one
- **WHEN** a shopper who holds a customer record at both shop A and shop B logs in at shop A with an active guest cart there
- **THEN** the merge targets their shop A customer record only, and their shop B cart is unchanged
