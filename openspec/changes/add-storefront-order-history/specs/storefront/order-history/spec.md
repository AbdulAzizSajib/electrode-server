## Purpose

Lets a signed-in customer find, read and cancel the orders on their account from the storefront, without needing the order number and phone that guest tracking asks for.

## ADDED Requirements

### Requirement: The account area links to order history
The storefront account area SHALL offer a "My Orders" entry leading to the customer's order history, listed before the other account shortcuts.

#### Scenario: Signed-in customer opens their account
- **WHEN** a signed-in customer views the account page
- **THEN** a "My Orders" entry is shown first among the account shortcuts
- **AND** choosing it opens the order history

### Requirement: Order history is available only to a signed-in customer
The order history list and every order detail page SHALL be shown only to a signed-in customer. A visitor who is not signed in SHALL be sent to the sign-in screen and, after signing in, returned to the page they asked for.

#### Scenario: Visitor not signed in opens order history
- **WHEN** a visitor who is not signed in opens the order history
- **THEN** they are sent to the sign-in screen
- **AND** after signing in they are returned to the order history

#### Scenario: Visitor not signed in opens an order
- **WHEN** a visitor who is not signed in opens an order detail page
- **THEN** they are sent to the sign-in screen
- **AND** after signing in they are returned to that order

### Requirement: The history lists the customer's own orders, newest first
The order history SHALL list only orders placed on the signed-in customer's account, newest first, ten per page, with a way to move between pages when there are more than ten. Each entry SHALL show the order number, the date it was placed, its status, how many items it contains and its total, and SHALL lead to that order's detail.

Orders placed while not signed in SHALL NOT appear.

#### Scenario: Customer with orders
- **WHEN** a signed-in customer with orders opens the order history
- **THEN** their orders are listed newest first
- **AND** each entry shows order number, date, status, item count and total

#### Scenario: More than one page of orders
- **WHEN** a customer has more than ten orders
- **THEN** the first ten are shown
- **AND** the customer can move to the next page and back

#### Scenario: Page number beyond the last page
- **WHEN** the history is opened at a page number past the last page
- **THEN** the page shows no orders and still offers a way back to the first page

#### Scenario: Customer with no orders
- **WHEN** a signed-in customer with no orders opens the order history
- **THEN** a message says they have not placed an order yet
- **AND** a link to the shop is offered

#### Scenario: Order placed as a guest
- **WHEN** a customer placed an order without signing in and later opens their order history signed in
- **THEN** that order is not listed

### Requirement: An order's detail matches what the customer was shown at checkout
The order detail page SHALL show the order's number, status and date placed, together with its items, amounts and delivery address or collection details presented exactly as on the order confirmation and on Track Order.

An order that does not exist, or that belongs to another customer, SHALL be reported as not found, with no indication of which of the two it is.

#### Scenario: Customer opens one of their orders
- **WHEN** a signed-in customer opens the detail of their own order
- **THEN** its number, status, date, items, amounts and delivery or collection details are shown

#### Scenario: Customer opens someone else's order
- **WHEN** a signed-in customer opens an order detail URL for an order on another account
- **THEN** a not-found page is shown
- **AND** nothing about that order is revealed

#### Scenario: Order does not exist
- **WHEN** a signed-in customer opens an order detail URL for an order that does not exist
- **THEN** the same not-found page is shown

### Requirement: A customer can cancel an order before it is processed
The order detail page SHALL offer a cancel action only while the order's status is `PENDING` or `CONFIRMED`, and SHALL ask the customer to confirm before cancelling. After a successful cancellation the page SHALL show the order as cancelled and no longer offer the action.

If the backend refuses the cancellation — for example because the order moved on while the page was open — the customer SHALL see why, and the page SHALL show the order's current status.

#### Scenario: Cancellable order
- **WHEN** a customer views their order whose status is `PENDING` or `CONFIRMED`
- **THEN** a cancel action is offered

#### Scenario: Order already in progress
- **WHEN** a customer views their order whose status is anything other than `PENDING` or `CONFIRMED`
- **THEN** no cancel action is offered

#### Scenario: Customer confirms cancellation
- **WHEN** a customer chooses cancel and confirms
- **THEN** the order is cancelled
- **AND** the page shows its status as cancelled
- **AND** the cancel action is no longer offered

#### Scenario: Customer backs out
- **WHEN** a customer chooses cancel and then declines the confirmation
- **THEN** the order is not cancelled

#### Scenario: Order moved on before the cancel arrived
- **WHEN** a customer confirms cancellation of an order that staff have since moved past `CONFIRMED`
- **THEN** the customer is told the order can no longer be cancelled
- **AND** the page shows the order's current status
