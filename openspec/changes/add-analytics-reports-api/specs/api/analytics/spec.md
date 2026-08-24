## Purpose

Extends the read-only, admin/staff-only `api/analytics` capability with reporting endpoints — best-sellers, sales by category, order-status and payment breakdowns, and a returns/refunds rate — computed live over existing order/product/payment data, no persisted analytics data of its own.

## ADDED Requirements

### Requirement: Reporting endpoints are admin/staff-only
An authenticated OWNER/ADMIN/STAFF SHALL be able to fetch any of the five reporting endpoints (top products, sales by category, order-status breakdown, payment breakdown, returns/refunds); no unauthenticated or customer-role request SHALL be able to reach any of them.

#### Scenario: Customer requests a reporting endpoint
- **WHEN** a customer-role request calls any of the five reporting endpoints
- **THEN** the response is 403

#### Scenario: Staff requests a reporting endpoint
- **WHEN** an OWNER, ADMIN, or STAFF request calls any of the five reporting endpoints
- **THEN** the response includes that endpoint's reporting data for the requested range

### Requirement: Reporting endpoints share the dashboard summary's range window
Each reporting endpoint SHALL accept the same `range` query parameter (`7d`, `30d`, or `90d`, default `30d`) as the existing dashboard-summary endpoint, scoping its computation to orders created within that window.

#### Scenario: Default range
- **WHEN** a reporting endpoint is called with no `range` query parameter
- **THEN** the response is scoped to the last 30 days

#### Scenario: Explicit range
- **WHEN** a reporting endpoint is called with `range=7d`
- **THEN** the response is scoped to the last 7 days

### Requirement: Top products ranks by quantity and revenue, excluding cancelled orders
The top-products endpoint SHALL return the best-selling products (or variants) within the window, ranked by total quantity sold, with each entry's total revenue also included; order items belonging to a `CANCELLED` order SHALL be excluded.

#### Scenario: Best-sellers within the window
- **WHEN** the top-products endpoint is requested for a range with sales activity
- **THEN** the response lists products ordered by quantity sold descending, each with its quantity and revenue for the window, excluding any items from cancelled orders

### Requirement: Sales by category groups revenue by each product's primary category
The sales-by-category endpoint SHALL return, for each `Category` that has at least one order item in the window, the total revenue and order-item count attributed to products whose primary category is that category; `CANCELLED` orders SHALL be excluded.

#### Scenario: Category breakdown
- **WHEN** the sales-by-category endpoint is requested for a range with sales across multiple categories
- **THEN** the response includes one entry per category with order-item revenue in that window, and categories with zero sales in the window are omitted

### Requirement: Order-status breakdown counts orders by status within the window
The order-status-breakdown endpoint SHALL return the count of orders created within the window for each `OrderStatus` value, including statuses with zero orders in the window.

#### Scenario: Status counts
- **WHEN** the order-status-breakdown endpoint is requested
- **THEN** the response includes a count for every `OrderStatus` value, using 0 for statuses with no orders in the window

### Requirement: Payment breakdown reports by method and by status
The payment-breakdown endpoint SHALL return, for payments created within the window, the count and total amount grouped by `PaymentMethod`, and separately the count grouped by `PaymentStatus`.

#### Scenario: Method and status split
- **WHEN** the payment-breakdown endpoint is requested for a range with payment activity
- **THEN** the response includes a count and amount per payment method, and a count per payment status, both scoped to payments created within the window

### Requirement: Returns/refunds reports counts and a refund rate
The returns-refunds endpoint SHALL return, within the window: the count of return requests grouped by `ReturnStatus`; the count and total amount of refunds grouped by `RefundStatus`; and a refund rate computed as the number of distinct orders with at least one refund in the window divided by the total number of orders in the window (0 when there are no orders in the window, not a division error).

#### Scenario: Returns and refunds summary
- **WHEN** the returns-refunds endpoint is requested for a range with return/refund activity
- **THEN** the response includes return-request counts by status, refund counts and amounts by status, and a refund rate between 0 and 1

#### Scenario: No orders in the window
- **WHEN** the returns-refunds endpoint is requested for a range with zero orders
- **THEN** the refund rate is 0 rather than an error or `NaN`
