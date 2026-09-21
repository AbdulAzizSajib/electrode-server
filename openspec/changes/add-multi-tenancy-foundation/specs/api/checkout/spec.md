## MODIFIED Requirements

### Requirement: A customer can only see their own orders; staff can see all
GET endpoints for orders SHALL scope results to the requesting customer unless the requester holds an OWNER/ADMIN/STAFF role **in the resolved tenant**, in which case results are scoped to that tenant's orders.

"All" SHALL mean all of the resolved tenant's orders and nothing beyond them. Staff SHALL NOT be able to reach an order belonging to any other tenant by any means, including by direct id, by filter, by sort, or by pagination past the end of their own tenant's results.

The wording matters: a staff-facing order list is the single largest surface on which a scoping mistake would be invisible to the merchant reading it and catastrophic for the merchant whose data appeared.

#### Scenario: Customer requests another customer's order
- **WHEN** a logged-in customer requests an order that belongs to a different customer
- **THEN** the response is 404 (not 403, to avoid confirming the order's existence)

#### Scenario: Staff list their shop's orders
- **WHEN** a user holding OWNER/ADMIN/STAFF in the resolved tenant lists orders
- **THEN** every order belonging to that tenant is returned and no order belonging to any other tenant is returned

#### Scenario: Staff request an order belonging to another shop
- **WHEN** a user holding OWNER/ADMIN/STAFF in tenant A requests, by id, an order belonging to tenant B
- **THEN** the response is 404, identically to a customer requesting an order that is not theirs

#### Scenario: Staff paginate past the end of their shop's orders
- **WHEN** a staff request pages beyond the last page of its own tenant's orders
- **THEN** an empty result is returned rather than results drawn from another tenant

## ADDED Requirements

### Requirement: Guest checkout abuse limits are counted per tenant

Guest checkout has neither a session nor a payment step, so the platform limits how many pending cash-on-delivery orders one phone number may hold and how many guest orders one network address may place per hour. Both limits SHALL be configured per tenant and counted per tenant.

One shop's guest traffic SHALL NOT consume another shop's allowance, and a shopper blocked at one shop SHALL NOT be blocked at another. Counting these globally would let one merchant's order volume — or one abuser targeting one merchant — deny checkout to every other merchant on the platform.

The limits themselves remain a merchant-tunable setting rather than a platform constant, unchanged from their existing behavior.

#### Scenario: The same phone reaches the cap at one shop
- **WHEN** a phone number holds the maximum number of pending COD orders at shop A and then attempts a guest order at shop B
- **THEN** the order at shop B is accepted, because shop B's count for that number is independent

#### Scenario: One address places guest orders at two shops
- **WHEN** a network address places guest orders at two different shops within the same hour
- **THEN** each shop's hourly count advances independently, and neither shop's limit is advanced by the other's traffic

#### Scenario: A shopper exceeds one shop's cap
- **WHEN** a guest exceeds the configured cap within a single tenant
- **THEN** the order is refused exactly as it was before tenancy existed, using that tenant's configured limits
