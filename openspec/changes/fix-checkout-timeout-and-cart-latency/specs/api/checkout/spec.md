## ADDED Requirements

### Requirement: Order placement is idempotent under retry
A checkout request MAY carry a client-generated idempotency key. When it does, the system SHALL create at most one `Order` for that key: replaying the same key SHALL return the originally created order rather than creating a second one, and SHALL NOT deduct stock, increment coupon usage, or clear the cart a second time. A request carrying no key SHALL be treated as a distinct checkout attempt, preserving existing behavior for callers that do not participate.

The key SHALL be scoped so that one customer's key cannot collide with another's, and SHALL be persisted alongside the order it created so that replay protection survives a process restart rather than living only in memory.

#### Scenario: Client retries after an indeterminate failure
- **WHEN** a customer's checkout commits but the response never reaches the client, and the client retries with the same idempotency key
- **THEN** the response is the order created by the first attempt
- **AND** no second `Order` is created, stock is deducted exactly once, and any coupon's `usageCount` is incremented exactly once

#### Scenario: Shopper double-clicks Place Order
- **WHEN** two checkout requests carrying the same idempotency key arrive concurrently
- **THEN** exactly one `Order` is created and both requests observe that same order

#### Scenario: A genuine second purchase of the same items
- **WHEN** a customer places an order, then later builds an identical cart and checks out again with a different idempotency key
- **THEN** a second, distinct `Order` is created — the identical contents do not suppress it

#### Scenario: Checkout without an idempotency key
- **WHEN** a checkout request arrives carrying no idempotency key
- **THEN** the order is placed as it is today, and the request is not rejected for the header's absence

### Requirement: An indeterminate checkout outcome is never reported as a definite failure
When the storefront cannot determine whether a checkout succeeded — because it abandoned the request before the server answered — it SHALL NOT tell the shopper the order failed, and SHALL NOT tell them the server was unreachable. It SHALL report the outcome as unknown and direct the shopper to check their orders before retrying. In that state the client SHALL treat its cached cart as stale and re-read it from the server rather than continuing to render the pre-checkout cart.

Checkout SHALL also complete fast enough that this state is exceptional: work that is not required to decide the order's outcome SHALL NOT delay the response after the order has committed.

#### Scenario: Storefront abandons a checkout request that later commits
- **WHEN** the storefront gives up waiting on a checkout that the server goes on to commit
- **THEN** the shopper is told the outcome is unknown and to check their orders before retrying, not that the order failed or that the server was unreachable
- **AND** the cart shown to the shopper is re-read from the server, so it no longer displays items the completed order already consumed

#### Scenario: Post-commit follow-up work does not delay the response
- **WHEN** an order commits and triggers follow-up work that does not affect the order's outcome, such as a low-stock alert
- **THEN** the checkout response is returned without waiting for that work to finish
