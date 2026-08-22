# Checkout Specification

## Purpose

Turns a customer's cart into a placed, trackable `Order` — the core transaction path of the store.

## Requirements

### Requirement: Placing an order snapshots cart contents into immutable order data
Checkout SHALL create an `Order` with `OrderItem` rows that copy the product name, SKU, and unit price at the moment of purchase, independent of later catalog changes.

#### Scenario: Product price changes after an order is placed
- **WHEN** a product's price changes after an order containing it was placed
- **THEN** the existing `OrderItem.unitPrice` on that order is unaffected

### Requirement: Checkout validates stock and price before creating the order
The order SHALL NOT be created if any cart line item's requested quantity exceeds available stock (per `Stock.quantity - Stock.reservedQuantity`), or if server-computed pricing disagrees with what the client expects to pay.

#### Scenario: Insufficient stock at checkout
- **WHEN** a customer checks out with a cart quantity exceeding available stock for one item
- **THEN** the order is rejected (409) and no `Order`/`OrderItem`/`Payment` rows are created

### Requirement: Order status changes are logged, not just overwritten
Every `Order.status` transition SHALL append an `OrderStatusHistory` row (`fromStatus`, `toStatus`, who changed it) rather than silently updating the status field alone.

#### Scenario: Admin marks an order as shipped
- **WHEN** an admin transitions an order from `PROCESSING` to `SHIPPED`
- **THEN** `Order.status` updates AND a new `OrderStatusHistory` row records the transition and the admin `User.id` that made it

### Requirement: A customer can only see their own orders; staff can see all
GET endpoints for orders SHALL scope results to the requesting customer unless the requester holds an OWNER/ADMIN/STAFF role.

#### Scenario: Customer requests another customer's order
- **WHEN** a logged-in customer requests an order that belongs to a different customer
- **THEN** the response is 404 (not 403, to avoid confirming the order's existence)

### Requirement: Shipment and shipping method are tracked per order
An order SHALL be assignable a `ShippingMethod` at checkout and, once dispatched, a `Shipment` with a tracking number and status independently updatable from the order's own status.

#### Scenario: Admin updates shipment tracking
- **WHEN** an admin adds a tracking number and carrier to an order's shipment
- **THEN** the `Shipment` record is updated and is retrievable by the order's customer
