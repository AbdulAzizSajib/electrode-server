## Purpose

Defines how a visitor buys from a single-product landing page — one pre-selected product, a quantity, a delivery area and a short address form submitted straight to a cash-on-delivery order — and how that order is priced, validated and attributed back to the campaign that produced it.

## ADDED Requirements

### Requirement: The landing page sells one pre-selected product with an adjustable quantity

The system SHALL present the landing page's bound product as already chosen, with a quantity control defaulting to 1. The shopper SHALL NOT have to add anything to a cart, open a cart, or navigate to a checkout page in order to buy. Adjusting the quantity SHALL update the displayed totals.

#### Scenario: Visitor orders the default quantity

- **WHEN** a visitor fills in the order form and submits without touching the quantity
- **THEN** an order is placed for one unit of the bound product

#### Scenario: Visitor increases the quantity

- **WHEN** a visitor raises the quantity to 3
- **THEN** the displayed item total, delivery charge and grand total update to reflect three units
- **AND** submitting places an order for three units

#### Scenario: Visitor lowers the quantity below one

- **WHEN** a visitor tries to reduce the quantity below 1
- **THEN** the quantity stays at 1

#### Scenario: Landing page order leaves the shopper's cart alone

- **GIVEN** a visitor with two products already in their cart
- **WHEN** they place an order from a landing page
- **THEN** the order contains only the landing page's product
- **AND** their cart still holds the same two products afterwards

### Requirement: Delivery is priced by the landing page's own delivery zones

The system SHALL let a merchant define, per landing page, an ordered list of delivery zones, each with a label and a price — for example `ঢাকার ভিতরে` at 60 and `ঢাকার বাইরে` at 120. A landing page SHALL have at least one zone. The shopper SHALL choose exactly one zone, and the system SHALL charge that zone's price as the delivery charge. A landing page order SHALL NOT be priced by the bound product's shipping rule, and the shop's free-shipping-by-order-value threshold and coupon shipping waivers SHALL NOT apply to it — the page states a delivery charge and that is what is charged.

#### Scenario: A newly created landing page

- **WHEN** a merchant creates a landing page and opens its order form settings
- **THEN** it is pre-filled with two zones, `ঢাকার ভিতরে` and `ঢাকার বাইরে`, which the merchant may rename, reprice, remove or add to

#### Scenario: Visitor picks a delivery zone

- **GIVEN** a landing page with zones `ঢাকার ভিতরে` at 60 and `ঢাকার বাইরে` at 120
- **WHEN** a visitor selects `ঢাকার বাইরে`
- **THEN** the displayed delivery charge is 120 and the grand total includes it
- **AND** the order placed is charged a delivery amount of 120

#### Scenario: Merchant tries to remove the last zone

- **WHEN** a merchant removes every delivery zone from a landing page and saves
- **THEN** the save is rejected stating that at least one delivery zone is required

#### Scenario: The bound product's shipping rule says something different

- **GIVEN** a landing page whose product's shipping rule charges 200 to the shopper's destination
- **WHEN** the shopper selects the page's 60 zone and orders
- **THEN** the order's delivery charge is 60

#### Scenario: The order value exceeds the shop's free-shipping threshold

- **GIVEN** a shop with a free-shipping threshold below the order's value
- **WHEN** a shopper orders from a landing page having selected a paid delivery zone
- **THEN** the zone's price is still charged
- **AND** the total charged equals the total the page displayed

#### Scenario: Visitor submits without choosing a zone

- **WHEN** a visitor submits the order form with no delivery zone selected
- **THEN** the submission is rejected naming the missing choice
- **AND** no order is created

### Requirement: The server, not the page, decides what the order costs

The system SHALL compute the item subtotal, tax and delivery charge for a landing page order on the server from the bound product's stored price and tax rule and the selected zone's stored price. A price sent by the browser SHALL never be trusted as an input to what is charged. The system SHALL provide the page with a server-computed quote so the totals a shopper sees before submitting are the totals they are charged, and SHALL reject a submission whose expected total disagrees with the server's.

#### Scenario: Page displays the total before submission

- **WHEN** a visitor changes the quantity or the delivery zone
- **THEN** the displayed subtotal, tax, delivery charge and grand total are the server's figures for that combination

#### Scenario: Tampered price submitted

- **WHEN** a submission arrives carrying a unit price or delivery price lower than the stored ones
- **THEN** the submitted figures are ignored and the order is priced from the stored ones

#### Scenario: Price changed between page load and submit

- **GIVEN** a visitor who loaded the page before the merchant raised the product's price
- **WHEN** they submit an order whose expected total is the old one
- **THEN** the order is rejected with a message stating the price changed, written in the shop's currency format
- **AND** no order is created

#### Scenario: Product carries a tax rule

- **GIVEN** a bound product with a tax rule
- **WHEN** a visitor views the landing page
- **THEN** the tax that rule charges is shown as part of the total
- **AND** the order is charged that same tax

### Requirement: The order form asks for a name, a phone number and an address

The system SHALL present a landing page order form of three fields — name, mobile number and delivery address — with merchant-editable labels, placeholders and helper text. The mobile number SHALL always be present and always required, and SHALL be validated as a Bangladeshi mobile number. The delivery address SHALL always be present and always required. The name field SHALL be present by default and MAY be made optional by the merchant, in which case an order placed without one is still accepted. The shop's general checkout field configuration SHALL NOT govern this form.

#### Scenario: Visitor fills in the form and submits

- **WHEN** a visitor enters a name, a valid Bangladeshi mobile number and an address, and submits
- **THEN** an order is placed carrying all three

#### Scenario: Visitor submits an invalid phone number

- **WHEN** a visitor submits a phone number that is not a valid Bangladeshi mobile number
- **THEN** the submission is rejected naming the phone field
- **AND** no order is created

#### Scenario: Visitor submits with the address blank

- **WHEN** a visitor submits with the address empty or containing only whitespace
- **THEN** the submission is rejected naming the address field
- **AND** no order is created

#### Scenario: Merchant makes the name optional

- **GIVEN** a landing page whose name field the merchant has marked optional
- **WHEN** a visitor submits with a phone number and address but no name
- **THEN** the order is placed

#### Scenario: Merchant tries to remove the phone field

- **WHEN** a merchant tries to hide or make optional the landing page's phone field
- **THEN** the change is rejected stating that the phone number is required for cash on delivery

#### Scenario: The shop's checkout configuration requires a postal code

- **GIVEN** a shop whose normal checkout requires city and postal code
- **WHEN** a visitor orders from a landing page, which asks for neither
- **THEN** the order is accepted

### Requirement: A landing page order is a cash-on-delivery guest order in the normal order pipeline

The system SHALL place a landing page order through the same pipeline as any other order: it SHALL receive an order number, deduct stock, create a PENDING cash-on-delivery payment, record its status history, notify the merchant, and appear in the admin order list, the customer's order history when the phone matches an existing customer, and the shop's reports. Landing page orders SHALL be subject to the same guest cash-on-delivery abuse limits — pending orders per phone number and guest orders per IP address per hour — as guest checkout. Only cash on delivery SHALL be offered.

#### Scenario: Order is placed

- **WHEN** a visitor submits a valid landing page order
- **THEN** an order is created with an order number, a PENDING cash-on-delivery payment and a status history entry
- **AND** it appears in the admin order list alongside orders from the normal checkout

#### Scenario: Insufficient stock

- **GIVEN** a bound product with 2 units available
- **WHEN** a visitor submits an order for 5
- **THEN** the order is rejected with a message naming the product and the available quantity
- **AND** no stock is deducted

#### Scenario: Phone has too many pending cash-on-delivery orders

- **GIVEN** a phone number already at the shop's limit for pending cash-on-delivery orders
- **WHEN** a further landing page order is submitted with that number
- **THEN** it is rejected
- **AND** the limit is the same one the normal guest checkout applies

#### Scenario: Shopper submits twice

- **WHEN** the same submission is sent twice with the same idempotency key
- **THEN** exactly one order exists
- **AND** the second attempt returns the order the first created

#### Scenario: Returning customer's phone

- **GIVEN** a phone number belonging to an existing customer
- **WHEN** an order is placed from a landing page with that number
- **THEN** the order is attached to that customer
- **AND** it is recorded as a guest order

### Requirement: An order records which landing page produced it and which zone was chosen

The system SHALL record on every landing page order the landing page it came from and the delivery zone the shopper selected. The admin panel SHALL show, for each landing page, how many orders and how much revenue it has produced, and SHALL show on each order which landing page it came from and which delivery area was chosen.

#### Scenario: Merchant reviews an order

- **WHEN** a merchant opens an order placed from a landing page
- **THEN** the order detail names the landing page it came from
- **AND** it shows the delivery area the shopper selected

#### Scenario: Merchant compares two campaigns

- **GIVEN** two published landing pages for the same product
- **WHEN** the merchant opens the Landing Pages list
- **THEN** each page shows its own order count and revenue

#### Scenario: Merchant deletes a landing page that has orders

- **WHEN** a merchant deletes a landing page that has produced orders
- **THEN** the orders are retained
- **AND** each still records the name of the landing page it came from

#### Scenario: An order from the normal checkout

- **WHEN** a merchant opens an order placed through the normal checkout
- **THEN** no landing page is named on it

### Requirement: The shopper is told the order succeeded and how to track it

The system SHALL, on a successful landing page order, show the shopper a confirmation carrying the order number and the merchant's authored thank-you message, without navigating away from the campaign. The confirmation SHALL tell the shopper how to track the order with the order number and the phone number they used.

#### Scenario: Order succeeds

- **WHEN** a visitor's order is placed successfully
- **THEN** the page shows the merchant's thank-you heading and message together with the order number
- **AND** the order form is no longer submittable

#### Scenario: Merchant has not authored a thank-you message

- **WHEN** an order succeeds on a landing page with no thank-you message set
- **THEN** a default confirmation carrying the order number is shown

#### Scenario: Shopper tracks the order

- **WHEN** the shopper follows the tracking instructions with the order number and the phone they ordered with
- **THEN** the order is found

#### Scenario: Submission fails

- **WHEN** a submission is rejected for any reason
- **THEN** the reason is shown beside the form with the entered values preserved
- **AND** the shopper can correct it and resubmit
