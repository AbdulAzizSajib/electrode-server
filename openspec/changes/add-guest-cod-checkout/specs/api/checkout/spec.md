## ADDED Requirements

### Requirement: Checkout does not require an authenticated session
Checkout SHALL accept an order from a visitor with no session, provided the request carries the contact and shipping details a guest has not saved anywhere. A missing or invalid session SHALL degrade the request to guest checkout rather than rejecting it.

#### Scenario: Guest places an order
- **WHEN** a visitor with no session posts a checkout request carrying full name, phone, and a complete shipping address
- **THEN** the order is created and returned with the same response shape an authenticated checkout returns

#### Scenario: Guest omits required contact details
- **WHEN** a visitor with no session posts a checkout request missing full name, phone, or any required shipping address field
- **THEN** the request is rejected (400) naming the missing fields, and no `Order` is created

#### Scenario: Expired session at checkout
- **WHEN** a request arrives with an expired or malformed session credential but valid guest checkout details
- **THEN** the request is treated as a guest checkout rather than returning 401

#### Scenario: Authenticated checkout is unaffected
- **WHEN** a logged-in customer checks out using a saved `shippingAddressId` and sends no guest contact fields
- **THEN** the order is created exactly as before this change, against their own customer record

### Requirement: Guest orders are identified and merged by phone number
A guest order SHALL resolve to the existing `Customer` bearing the submitted phone number, or create one when no such customer exists. A `Customer` created this way SHALL have no linked user account. Phone number SHALL be unique across customers so that it can serve as this merge key.

#### Scenario: Repeat guest buyer
- **WHEN** a guest places an order with a phone number that a previous guest order already used
- **THEN** the new order attaches to that same `Customer`, and both orders appear in that customer's order history

#### Scenario: First-time guest buyer
- **WHEN** a guest places an order with a phone number no customer holds
- **THEN** a `Customer` is created with that phone and no linked user account, and the order attaches to it

#### Scenario: Guest phone matches a registered customer
- **WHEN** a guest checks out with a phone number belonging to a customer who has a registered user account
- **THEN** the order attaches to that existing customer record without granting the guest any access to that account's session, saved addresses, or past orders

### Requirement: Guest checkout captures the shipping address from the request
A guest has no saved addresses, so checkout SHALL accept a complete shipping address in the request payload and persist it against the resolved customer for use as the order's shipping address. Authenticated checkout SHALL continue to accept a reference to an already-saved address.

#### Scenario: Guest supplies a new address
- **WHEN** a guest checks out with a full shipping address in the payload
- **THEN** the address is stored against the resolved customer and linked to the order

#### Scenario: Guest attempts to reference a saved address
- **WHEN** a guest checkout request supplies a saved address identifier instead of full address fields
- **THEN** the request is rejected (400), since a guest cannot prove ownership of a stored address

### Requirement: Guest orders are cash-on-delivery only
An order placed without a session SHALL record a payment of method COD with status pending, and SHALL NOT accept an online payment method. The order SHALL enter the same initial status as an authenticated order.

#### Scenario: Guest order records COD payment
- **WHEN** a guest order is created successfully
- **THEN** a payment record exists for that order with method COD, status pending, and an amount equal to the order total

#### Scenario: Guest requests an online payment method
- **WHEN** a guest checkout request specifies a payment method other than COD
- **THEN** the request is rejected (400) and no order is created

### Requirement: Guest ordering is rate-limited to contain abuse
Because guest checkout has neither a session nor a payment step, the system SHALL cap how many unfulfilled COD orders a single phone number may hold concurrently, and how many guest orders may originate from one network address within a rolling window. An order rejected by these limits SHALL NOT reserve or deduct stock.

#### Scenario: Phone exceeds its pending-order cap
- **WHEN** a guest submits an order using a phone number that already holds the maximum permitted unfulfilled COD orders
- **THEN** the request is rejected (429) and no stock is deducted

#### Scenario: Network address exceeds its rate limit
- **WHEN** guest orders from one network address exceed the permitted count within the rolling window
- **THEN** further guest orders from that address are rejected (429) until the window advances

#### Scenario: Earlier orders resolved
- **WHEN** a phone number's earlier COD orders have been delivered or cancelled so that it no longer holds the maximum
- **THEN** that phone number may place a guest order again

#### Scenario: Limits do not apply to authenticated checkout
- **WHEN** a logged-in customer checks out
- **THEN** the guest rate limits do not apply to the request

### Requirement: A guest can track an order without a session
A guest SHALL be able to retrieve one of their own orders by presenting the order number together with the phone number the order was placed with. Presenting an order number alone SHALL NOT return an order.

#### Scenario: Guest looks up their order
- **WHEN** a guest requests an order by its order number and the matching phone number
- **THEN** the order and its current status are returned

#### Scenario: Guest supplies a mismatched phone
- **WHEN** a guest requests an order by a valid order number and a phone number that did not place it
- **THEN** the response is 404, revealing nothing about whether that order number exists

## MODIFIED Requirements

### Requirement: A customer can only see their own orders; staff can see all
GET endpoints for orders SHALL scope results to the requesting customer unless the requester holds an OWNER/ADMIN/STAFF role. A request carrying no session SHALL NOT return orders through these endpoints; a guest retrieves an order only through the order-number-plus-phone lookup, which authorizes against the order's own phone number rather than a session.

#### Scenario: Customer requests another customer's order
- **WHEN** a logged-in customer requests an order that belongs to a different customer
- **THEN** the response is 404 (not 403, to avoid confirming the order's existence)

#### Scenario: Session-less request to a session-scoped order endpoint
- **WHEN** a request with no session calls a session-scoped order endpoint
- **THEN** the response is 401 and no order data is returned

#### Scenario: Registered customer sees orders placed as a guest
- **WHEN** a customer logs in whose customer record accumulated orders placed as a guest against the same phone number
- **THEN** those orders appear in their order history, since both attach to one customer record
