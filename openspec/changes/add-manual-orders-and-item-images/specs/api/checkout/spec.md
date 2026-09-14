## ADDED Requirements

### Requirement: Staff can place an order on a customer's behalf

An OWNER/ADMIN/STAFF user SHALL be able to create an order for a customer who never used the storefront, supplying the customer's phone number, delivery address, chosen delivery option and the catalog lines they agreed to buy. No other role SHALL be able to reach this, and an unauthenticated request SHALL NOT.

The customer SHALL be resolved by phone number on the same phone-as-identity rule the guest checkout uses: an existing customer with that number is reused rather than duplicated, and an unknown number creates a customer record.

A staff-placed order SHALL be indistinguishable from a self-service one in everything that makes an order an order — it SHALL receive an order number, deduct stock, append status history, and be visible to every order read, report and courier flow that any other order is. It SHALL NOT be a second, parallel kind of record that the rest of the system has to learn about.

#### Scenario: Staff places an order for a returning customer

- **WHEN** a staff user submits a manual order with a phone number that already belongs to a customer
- **THEN** the order is created against that existing customer rather than a duplicate, and appears in that customer's order history

#### Scenario: Staff places an order for an unknown phone number

- **WHEN** a staff user submits a manual order with a phone number no customer holds
- **THEN** a customer record is created for that number and the order is placed against it

#### Scenario: A customer attempts to create a manual order

- **WHEN** a logged-in non-staff customer calls the manual order endpoint
- **THEN** the request is rejected (403) and no order, customer or stock movement is created

#### Scenario: An unauthenticated request attempts to create a manual order

- **WHEN** the manual order endpoint is called with no session
- **THEN** the request is rejected (401)

#### Scenario: An invalid phone number is refused

- **WHEN** a staff user submits a manual order whose phone number is not a valid Bangladeshi mobile number
- **THEN** the request is rejected (400) naming the phone number, and no customer is created

### Requirement: A manual order is priced from the catalog, never from the request

The unit price of every line on a staff-placed order SHALL be read from the catalog at placement, exactly as checkout reads it. A unit price, line total or order total supplied in the request SHALL NOT be trusted as a price.

A negotiated price SHALL be expressed as a single order-level discount amount with a reason, recorded on the order. The discount SHALL NOT exceed the order's subtotal, and SHALL be refused without a reason.

Tax and delivery SHALL be computed from the resulting figures by the same rules a storefront order uses, so that a manual order and a website order for the same basket, discount and delivery option produce the same total.

#### Scenario: A price supplied in the request is ignored

- **WHEN** a staff user submits a manual order line carrying a unit price below the product's catalog price
- **THEN** the line is priced at the catalog price and the submitted figure has no effect on the order's total

#### Scenario: A negotiated discount is recorded

- **WHEN** a staff user places a manual order with a discount amount and a reason
- **THEN** the order's total is reduced by that amount, and both the amount and the reason are stored on the order and returned by every staff order read

#### Scenario: A discount without a reason is refused

- **WHEN** a staff user submits a manual order with a discount amount and no reason
- **THEN** the request is rejected (400) and no order is created

#### Scenario: A discount larger than the order is refused

- **WHEN** a staff user submits a discount exceeding the order's subtotal
- **THEN** the request is rejected (400) and no order is created

#### Scenario: Manual and website totals agree

- **WHEN** the same lines, delivery option and discount are placed once manually and once through checkout
- **THEN** the two orders carry the same subtotal, delivery amount, tax amount and total

### Requirement: Staff can price a manual order before placing it

A staff user SHALL be able to obtain the price of a prospective manual order — subtotal, discount, delivery, tax and total — without placing it, for the same lines, delivery option and discount the order would carry. The figures returned SHALL be the figures the order would be created with.

An operator agreeing a price in a live conversation has to state the total before committing, and a total worked out independently by the client is a total that disagrees with the order the moment any pricing rule changes.

Pricing a prospective order SHALL have no side effects. In particular it SHALL NOT create or modify any customer record, including one for the staff user's own account, and SHALL NOT read or consume any cart.

#### Scenario: Staff prices a prospective order

- **WHEN** a staff user requests a price for a set of lines, a delivery option and a discount
- **THEN** the response carries the subtotal, discount, delivery amount, tax and total those inputs produce

#### Scenario: The quoted figure is the placed figure

- **WHEN** a staff user prices a prospective order and then places it with the same inputs
- **THEN** the created order's subtotal, discount, delivery amount, tax and total match the quoted ones

#### Scenario: Pricing creates no customer for the operator

- **WHEN** a staff user prices a prospective order
- **THEN** no customer record is created or modified for the staff user's own account

#### Scenario: A discount is reflected in the quoted tax

- **WHEN** a prospective order is priced with a discount
- **THEN** the quoted tax reflects the discounted line amounts rather than the undiscounted ones

### Requirement: A manual order obeys the same stock rules as checkout

A staff-placed order SHALL deduct stock from the warehouse ledger in the same transaction that creates it, and SHALL be rejected in full if any line's quantity exceeds available stock. Staff SHALL NOT be able to place an order that oversells.

An operator who has already promised goods to a customer needs to find out that the shelf is empty at the moment they record the order, not when the packer cannot find it.

#### Scenario: A manual order deducts stock

- **WHEN** a staff user places a manual order for two units of a product
- **THEN** two units are deducted from the warehouse ledger and the movement is recorded against the order, identically to a website order

#### Scenario: A manual order exceeding stock is refused

- **WHEN** a staff user places a manual order for more units than are available
- **THEN** the order is rejected (409) naming the short line, and no order, payment or stock movement is created

#### Scenario: Cancelling a manual order returns its stock

- **WHEN** an unfulfilled manual order is cancelled
- **THEN** its stock is returned exactly as a cancelled website order's is

### Requirement: A manual order starts pending and carries a cash-on-delivery payment

A staff-placed order SHALL start in `PENDING`, the status a website order starts in, so both populations enter the same fulfilment queue and any "new orders to confirm" view keeps working unchanged.

It SHALL be created with a `PENDING` cash-on-delivery `Payment` for the order total, in the same transaction as the order, so a cash-on-delivery order can never commit without one and go missing from reconciliation.

Money already collected in advance SHALL be recorded afterwards through the existing per-order payment endpoint rather than at creation, so there is one way to record a payment rather than two.

#### Scenario: A manual order enters the normal queue

- **WHEN** a staff user places a manual order
- **THEN** its status is `PENDING` and a status history entry records the transition and the staff user who made it

#### Scenario: A manual order has a payment to reconcile

- **WHEN** a manual order is created
- **THEN** a `PENDING` cash-on-delivery `Payment` exists for its total amount

#### Scenario: An advance payment is recorded after creation

- **WHEN** a customer paid part of a manual order in advance
- **THEN** staff record it against the created order through the existing payment endpoint, and the order's cash-on-delivery payment is unaffected by the creation call itself

### Requirement: Guest abuse limits do not apply to staff-placed orders

The per-phone unfulfilled-cash-on-delivery cap and the per-IP hourly cap SHALL NOT apply to an order placed by a staff user. Those limits exist because a guest checkout has neither a session nor an accountable person behind it; a staff-placed order has both, and the IP being counted would be the shop's own.

The shop-wide checkout field configuration and its `allowGuestCheckout` switch SHALL NOT gate a staff-placed order either — an operator recording a sale that already happened is not the audience for a setting that decides what the storefront's form asks a shopper.

A staff-placed order SHALL still require a phone number and a delivery address, since neither the courier nor the customer's own order lookup works without them.

#### Scenario: A phone at the guest cap can still be served manually

- **WHEN** a staff user places a manual order for a phone number already holding more unfulfilled cash-on-delivery orders than the guest cap allows
- **THEN** the order is created

#### Scenario: Guest checkout being switched off does not block staff

- **WHEN** guest checkout is disabled shop-wide and a staff user places a manual order
- **THEN** the order is created

#### Scenario: A manual order still requires a phone number

- **WHEN** a staff user submits a manual order with no phone number
- **THEN** the request is rejected (400) and no order is created

#### Scenario: A manual order still requires a delivery address

- **WHEN** a staff user submits a manual order for delivery with no address
- **THEN** the request is rejected (400) and no order is created

### Requirement: A repeated manual order submission creates one order

A manual order submission carrying an idempotency key SHALL create at most one order. A repeat of the same key SHALL return the order the first submission created, rather than placing a second one and deducting stock twice.

An operator on a slow connection clicking a submit button twice must not send the customer two parcels.

#### Scenario: The same submission is sent twice

- **WHEN** a staff user submits the same manual order twice with the same idempotency key
- **THEN** one order exists, stock is deducted once, and the second call returns the first call's order

#### Scenario: Two different manual orders are not confused

- **WHEN** a staff user places two genuinely different manual orders with different idempotency keys
- **THEN** both orders are created

### Requirement: Every order records where it came from and who created it

An order SHALL record the channel the customer reached the shop through, distinguishing a self-service storefront order from one taken over WhatsApp, Messenger, a phone call or in person. An order placed by staff SHALL additionally record which staff user placed it.

Orders placed before this existed, and every order placed through the storefront, SHALL read as the storefront channel with no staff user recorded — the absence of a person is what says "the customer placed this themselves".

Campaign attribution SHALL NOT be expressed through this field. Which landing page produced an order is already recorded on the order, and answering one question from two independently-written fields is how the two come to disagree.

#### Scenario: A manual order records its channel and its author

- **WHEN** a staff user places a manual order and states the customer reached them on WhatsApp
- **THEN** the order records the WhatsApp channel and the staff user's id, and both are returned by staff order reads

#### Scenario: A storefront order records no author

- **WHEN** a customer places an order through the storefront
- **THEN** the order records the storefront channel and no staff user

#### Scenario: Orders can be filtered and counted by channel

- **WHEN** staff list orders filtered to a channel
- **THEN** only orders recorded against that channel are returned

#### Scenario: An unrecognised channel is refused

- **WHEN** a manual order is submitted with a channel outside the recorded set
- **THEN** the request is rejected (400) and no order is created

### Requirement: An order read names each line's current product image

Every order read SHALL return, for each line, the image that line's product or variant currently shows — the variant's own image when the line names a variant, otherwise the product's primary image — as a single value per line, or nothing when the product has no image at all.

This SHALL be true of list reads as well as detail reads, and SHALL take the same shape for staff and for customers. An operator matching a parcel against a shelf reads the list; making them open each order to see what is in it is the same cost as not showing it.

The image is deliberately today's catalog picture rather than a snapshot captured at placement, unlike the line's name, SKU and price. Those are what the customer was sold and are accountable facts of the transaction; a photograph is not, and marketing replacing a thumbnail does not make a placed order's record untrue.

A list read SHALL NOT cost a request per row to produce this.

#### Scenario: The orders list names each line's image

- **WHEN** staff list orders
- **THEN** each line of each order carries its current product image, in the same shape a detail read returns

#### Scenario: A variant line shows the variant's image

- **WHEN** an order line names a product variant that has its own image
- **THEN** that line's image is the variant's, not the product's primary image

#### Scenario: A line whose product has no image

- **WHEN** an order line's product and variant both have no image
- **THEN** the line carries no image rather than a broken or invented value

#### Scenario: Staff and customer reads agree

- **WHEN** the same order is read by staff and by the customer who placed it
- **THEN** each line's image is present in the same shape in both responses

#### Scenario: A replaced product image shows through to past orders

- **WHEN** a product's primary image is replaced after an order containing it was placed
- **THEN** that order's line shows the new image, while its name, SKU and unit price are unchanged
