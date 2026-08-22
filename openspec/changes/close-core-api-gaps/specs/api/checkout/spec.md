## MODIFIED Requirements

### Requirement: Checkout validates stock and price before creating the order
The order SHALL NOT be created if any cart line item's requested quantity exceeds available stock — summed across every warehouse's `Stock.quantity - Stock.reservedQuantity` for that product/variant, not a single warehouse or the denormalized catalog total — or if server-computed pricing (including tax and any free-shipping adjustment) disagrees with what the client expects to pay. When an item's requested quantity is satisfied by more than one warehouse's stock, the deduction SHALL be split across those warehouses (largest available quantity first).

#### Scenario: Insufficient stock at checkout
- **WHEN** a customer checks out with a cart quantity exceeding the total available stock (summed across all warehouses) for one item
- **THEN** the order is rejected (409) and no `Order`/`OrderItem`/`Payment`/`Stock` rows are changed

#### Scenario: An order line is fulfilled by splitting across warehouses
- **WHEN** a cart line's requested quantity exceeds what any single warehouse holds but is covered by two warehouses combined
- **THEN** the order is created, and `Stock.quantity` is decremented at each contributing warehouse (largest-stock warehouse first) with a corresponding `StockMovement` per warehouse

## ADDED Requirements

### Requirement: Order totals reflect the store's tax rate and free-shipping threshold
Checkout SHALL compute `Order.taxAmount` from the store's configured `defaultTaxRatePercent`, and SHALL waive the shipping charge whenever the order's subtotal meets or exceeds the store's configured `freeShippingThreshold` (in addition to any coupon-driven free-shipping already in effect).

#### Scenario: Tax is applied to a checkout
- **WHEN** a customer checks out and the store has a non-zero `defaultTaxRatePercent` configured
- **THEN** the created order's `taxAmount` reflects that rate applied to the order subtotal

#### Scenario: Order subtotal meets the free-shipping threshold
- **WHEN** a customer checks out with a subtotal at or above the store's configured `freeShippingThreshold`
- **THEN** the order's `shippingAmount` is `0`, even if a paid `ShippingMethod` was selected

### Requirement: A customer can cancel their own order before it starts fulfillment
An authenticated customer SHALL be able to cancel their own order while it is still `PENDING` or `CONFIRMED`; SHALL NOT be able to cancel an order that has moved further (`PROCESSING` or later) or one that belongs to another customer.

#### Scenario: Customer cancels a pending order
- **WHEN** a customer cancels their own order while it is `PENDING`
- **THEN** the order's status becomes `CANCELLED` and an `OrderStatusHistory` row records the change

#### Scenario: Customer attempts to cancel an order already being processed
- **WHEN** a customer attempts to cancel their own order that is `PROCESSING` or later
- **THEN** the request is rejected (400) and the order's status is unchanged
