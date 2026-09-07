## ADDED Requirements

### Requirement: Cancelling an unfulfilled order returns its stock
Checkout deducts stock when an order is placed. Cancelling that order before the goods have left SHALL return the deducted quantity to the warehouse it came from, in the same transaction as the status change, and record the reversal as a `StockMovement` distinguishable from a manual correction.

Without this, every cancellation permanently shrinks sellable inventory: the goods are still on the shelf but the system no longer believes they exist, and nothing reports the discrepancy.

An order cancelled *after* fulfilment SHALL NOT be restocked by this path — those goods are with the customer and come back, if at all, through the return flow.

#### Scenario: Admin cancels an order that has not shipped
- **WHEN** an admin transitions a `PENDING` or `CONFIRMED` order to `CANCELLED`
- **THEN** each line's quantity is added back to the `Stock` row it was deducted from, the denormalized product and variant totals move with it, and a `StockMovement` records the reversal against the order

#### Scenario: Customer cancels their own order
- **WHEN** a customer cancels their own order while it is still cancellable
- **THEN** the stock is returned exactly as it is for an admin-initiated cancellation

#### Scenario: A cancelled order is not restocked twice
- **WHEN** a cancellation is attempted against an order already in `CANCELLED`
- **THEN** the request is rejected and no further stock is returned

#### Scenario: Cancelling a delivered order does not invent stock
- **WHEN** cancellation is attempted on an order whose goods have already been dispatched or delivered
- **THEN** no stock is returned by the cancellation itself

### Requirement: Order status transitions are constrained
An order's status SHALL only move along transitions that describe something that can actually happen. A transition that contradicts the order's history — reviving a cancelled order as delivered, or returning a completed order to pending — SHALL be rejected, naming the attempted transition.

Today the only check is that the status is changing at all, so any status can follow any other. That matters beyond tidiness: money- and inventory-bearing side effects key off these transitions, and a transition that could never occur physically produces side effects that cannot be reconciled.

#### Scenario: Reviving a cancelled order
- **WHEN** an admin attempts to move a `CANCELLED` order to `DELIVERED`
- **THEN** the request is rejected (400) with a message naming the from/to statuses

#### Scenario: A legal transition still succeeds
- **WHEN** an admin moves an order from `PROCESSING` to `SHIPPED`
- **THEN** the transition succeeds and is appended to the order's status history as before

### Requirement: A coupon's recorded usage matches its real redemptions
The usage a coupon is judged against SHALL reflect redemptions that still stand. An order that was cancelled SHALL NOT continue to consume the coupon's global allowance.

A coupon's global limit and its per-customer limit SHALL be judged consistently: it SHALL NOT be possible for a cancelled order to free a customer's own allowance while permanently consuming the global one.

Where usage is stored rather than derived, an OWNER/ADMIN SHALL be able to correct the stored figure, and the correction SHALL be audit-logged.

#### Scenario: An order using a coupon is cancelled
- **WHEN** an order that redeemed a coupon is cancelled
- **THEN** that redemption no longer counts against the coupon's global usage limit

#### Scenario: A coupon at its limit through cancelled orders still redeems
- **WHEN** a coupon with a limit of 100 has 70 standing redemptions and 30 cancelled ones
- **THEN** the coupon is still redeemable

#### Scenario: Admin corrects a drifted usage count
- **WHEN** an OWNER/ADMIN corrects a coupon's recorded usage to match its real redemptions
- **THEN** the stored figure is updated and an audit log entry records who changed it and from what

## MODIFIED Requirements

### Requirement: Order status changes are logged, not just overwritten
Every `Order.status` transition SHALL append an `OrderStatusHistory` row (`fromStatus`, `toStatus`, who changed it) rather than silently updating the status field alone.

A transition that carries side effects on stock or money SHALL apply them in the same transaction as the status change and its history row, so the ledger can never disagree with the status that caused it.

#### Scenario: Admin marks an order as shipped
- **WHEN** an admin transitions an order from `PROCESSING` to `SHIPPED`
- **THEN** `Order.status` updates AND a new `OrderStatusHistory` row records the transition and the admin `User.id` that made it

#### Scenario: A failed side effect leaves the status unchanged
- **WHEN** a transition's stock or money side effect cannot be applied
- **THEN** the status change, its history row, and the side effect all roll back together, leaving the order as it was
