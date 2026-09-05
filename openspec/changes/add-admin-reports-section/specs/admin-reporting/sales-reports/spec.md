## Purpose

Defines what the admin panel counts as a sale over a period and how it is summarised — the money columns a merchant sees, the groupings available, how cancelled orders and refunds are treated, and the guarantee that the sales report and the dashboard never disagree about the same window.

## ADDED Requirements

### Requirement: The Sales report covers orders placed in the chosen range, excluding cancelled ones

The system SHALL include an order in the Sales report when it was placed inside the chosen date range and is not cancelled. Placement date, not delivery or payment date, SHALL determine which period an order falls in.

#### Scenario: Order placed inside the range

- **WHEN** an order was placed on 12 March and the range is 1–31 March
- **THEN** it is included

#### Scenario: Order placed before the range but delivered inside it

- **WHEN** an order was placed on 27 February and delivered on 3 March, and the range is 1–31 March
- **THEN** it is not included, because it belongs to February

#### Scenario: Cancelled order

- **WHEN** an order placed inside the range has been cancelled
- **THEN** it is excluded from every figure in the report

#### Scenario: Order not yet delivered

- **WHEN** an order placed inside the range is still pending or processing
- **THEN** it is included, because it is a booked sale that has not been cancelled

### Requirement: The Sales report separates booked, collected and outstanding money

The system SHALL report, over the filtered result, gross sales before discount, discount given, shipping charged, tax charged, order total, amount collected, amount outstanding, and amount refunded. Amount collected SHALL count only payments that have settled; amount outstanding SHALL be order total minus amount collected.

#### Scenario: Fully paid order

- **WHEN** an order totalling ৳5,000 has a settled payment of ৳5,000
- **THEN** it contributes ৳5,000 to order total, ৳5,000 to collected and ৳0 to outstanding

#### Scenario: Unpaid cash-on-delivery order

- **WHEN** an order totalling ৳5,000 has a payment recorded but not yet settled
- **THEN** it contributes ৳5,000 to order total, ৳0 to collected and ৳5,000 to outstanding

#### Scenario: Partly paid order

- **WHEN** an order totalling ৳5,000 has settled payments of ৳3,000
- **THEN** it contributes ৳3,000 to collected and ৳2,000 to outstanding

#### Scenario: Order totals decompose

- **WHEN** any order is included
- **THEN** its gross sales minus discount plus shipping plus tax equals its order total

#### Scenario: Failed payment does not count as collected

- **WHEN** an order's only payment attempt failed
- **THEN** nothing is added to collected and the full order total is outstanding

### Requirement: Refunds are reported separately and never reduce sales figures

The system SHALL report refunded amounts as their own figure and SHALL NOT subtract them from gross sales, order total or amount collected. A refund SHALL be attributed to the period of the order it belongs to, so an order and its refund are never split across two reports.

#### Scenario: Order refunded in a later month

- **WHEN** an order placed on 20 March is refunded on 4 April
- **THEN** the March report shows the order at its full value and shows the refund against it, and the April report shows neither

#### Scenario: Refund does not shrink revenue

- **WHEN** a ৳5,000 order is fully refunded
- **THEN** order total still counts ৳5,000, and ৳5,000 appears as refunded

#### Scenario: Net figure is stated

- **WHEN** the report is shown
- **THEN** a net figure of order total minus refunded is stated alongside them, so the merchant does not have to subtract by hand

### Requirement: Sales can be grouped by day, product, category or payment method

The system SHALL let a merchant group the Sales report by day, by product, by category, or by payment method. Whichever grouping is chosen, the group amounts SHALL sum to the report's stated total.

#### Scenario: Grouped by day

- **WHEN** a merchant groups by day over a 31-day range
- **THEN** one row per day with activity is shown, and the daily order totals sum to the range total

#### Scenario: Grouped by product

- **WHEN** a merchant groups by product
- **THEN** one row per product sold in the range is shown with quantity sold and revenue, ordered by revenue descending

#### Scenario: Grouped by category

- **WHEN** a merchant groups by category and a product belongs to two categories
- **THEN** the product's revenue is not counted twice in the report total, and the report states how a multi-category product is attributed

#### Scenario: Grouped by payment method

- **WHEN** a merchant groups by payment method
- **THEN** one row per method used in the range is shown with the amount collected through it, and orders with no settled payment appear under an explicit unpaid group rather than being dropped

#### Scenario: Group totals always reconcile

- **WHEN** any grouping is applied
- **THEN** the sum of the group amounts equals the report total for the same measure

### Requirement: The Sales report and the dashboard never state different revenue for the same window

The system SHALL apply one definition of revenue across the dashboard and the Sales report. When the Sales report is run over the same window the dashboard summarises, the revenue figures SHALL be equal.

#### Scenario: Same window, same figure

- **WHEN** the dashboard shows revenue for the last 30 days and the Sales report is run for exactly those 30 days
- **THEN** the two revenue figures are equal

#### Scenario: Definition is stated on the report

- **WHEN** a merchant views the Sales report
- **THEN** the page states that revenue counts non-cancelled orders by placement date, so the figure cannot be misread as cash collected

### Requirement: The Sales report can be narrowed to a customer type, status or method

The system SHALL let a merchant narrow the Sales report by order status, by payment method, and by whether the order was placed as a guest. Every money figure and grouping SHALL respect the applied filters.

#### Scenario: Filtered to delivered orders

- **WHEN** a merchant filters to delivered orders
- **THEN** every figure and group covers delivered orders alone

#### Scenario: Filtered to guest orders

- **WHEN** a merchant filters to guest orders
- **THEN** only orders placed without a signed-in customer are counted

#### Scenario: Cancelled cannot be selected back in

- **WHEN** a merchant looks at the order-status filter
- **THEN** cancelled is not offered as a selectable status, because cancelled orders are excluded from the report by definition
