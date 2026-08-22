## Purpose

Covers what happens after an order is delivered: the customer may return items, get refunded, or leave a review.

## ADDED Requirements

### Requirement: A return can only be requested for items actually on the order
A `ReturnRequest`'s `ReturnItem` rows SHALL reference `OrderItem`s that belong to the same order and customer making the request, with quantity not exceeding what was ordered.

#### Scenario: Requesting a return for more than was ordered
- **WHEN** a customer requests a return quantity greater than the original `OrderItem.quantity`
- **THEN** the request is rejected (400)

### Requirement: Refunds are tied to a specific order and, optionally, a specific payment
A `Refund` SHALL always reference its `Order`; when it corresponds to a specific `Payment` (e.g. multiple payment attempts on one order), that link SHALL be recorded.

#### Scenario: Admin issues a refund after approving a return
- **WHEN** an admin approves a `ReturnRequest` and issues a refund for it
- **THEN** a `Refund` row is created against the order (and payment, if determinable), and the return's status moves to a terminal state

### Requirement: Only a verified purchaser can review a product
A `Review` SHALL only be creatable by a customer who has at least one `OrderItem` for that product on an order that has reached a completed/delivered state.

#### Scenario: Customer who never purchased the product attempts a review
- **WHEN** a customer with no qualifying order for a product submits a review for it
- **THEN** the request is rejected (403)

### Requirement: Reviews are moderated before appearing publicly
A newly created `Review` SHALL default to `PENDING` and SHALL NOT appear in public product review listings until an admin sets it to `APPROVED`.

#### Scenario: Public review listing excludes pending reviews
- **WHEN** an anonymous request lists reviews for a product with both `APPROVED` and `PENDING` reviews
- **THEN** only the `APPROVED` ones are returned
