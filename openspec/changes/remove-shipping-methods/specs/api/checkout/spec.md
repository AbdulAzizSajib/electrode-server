## ADDED Requirements

### Requirement: Shipment is tracked per order
Once dispatched, an order SHALL carry a `Shipment` with a carrier, a tracking number and a status, each updatable independently of the order's own status. The shipment SHALL NOT reference a stored delivery product; who is carrying the parcel is recorded as free text on the shipment itself, because it is a fact about that dispatch rather than a catalogue entity a merchant maintains.

#### Scenario: Admin updates shipment tracking
- **WHEN** an admin adds a tracking number and carrier to an order's shipment
- **THEN** the `Shipment` record is updated and is retrievable by the order's customer

#### Scenario: Shipment status moves without moving the order
- **WHEN** an admin sets a shipment's status to delivered
- **THEN** the shipment reflects it and the order's own status is unchanged until it is transitioned separately

### Requirement: Delivery price is derived from the shipping rules of the products being bought
Checkout and the pre-purchase quote SHALL compute delivery cost by matching the order's destination against the places of each distinct shipping rule carried by the products in the order, and SHALL NOT accept any client-supplied delivery selection or price. Two callers pricing the same basket to the same destination SHALL arrive at the same amount.

#### Scenario: Basket priced from the matched places
- **WHEN** a shopper checks out a basket whose products carry two different shipping rules, each matching a place at their destination
- **THEN** delivery is charged once per distinct rule and the total is the sum of the two matched places' prices

#### Scenario: Client supplies a delivery selection
- **WHEN** a checkout or quote request includes a delivery selection or price of its own
- **THEN** it has no effect on what is charged, and the amount is the one computed from the products' shipping rules

#### Scenario: Quote and checkout agree
- **WHEN** a shopper is quoted a delivery amount and then places that same order to the same destination
- **THEN** the amount charged equals the amount quoted

### Requirement: An order no product of which carries a shipping rule is refused
When no line in the order carries a shipping rule, checkout SHALL reject the order rather than deliver it free of charge. A product with no rule alongside products that have one SHALL continue to ride along at no additional cost, since it travels in a parcel already being paid for.

#### Scenario: Every product lacks a shipping rule
- **WHEN** a shopper checks out a basket in which no product carries a shipping rule
- **THEN** the order is rejected (400) with a message saying the items cannot be delivered, and no `Order` row is created

#### Scenario: One product lacks a shipping rule
- **WHEN** a shopper checks out a basket in which one product carries no shipping rule and another does
- **THEN** the order is accepted and delivery is charged only for the rule that matched, with nothing added for the rule-less product

## REMOVED Requirements

### Requirement: Shipment and shipping method are tracked per order
**Reason**: The `ShippingMethod` half of this requirement is a flat price with no geography, superseded by shipping rules in `align-admin-catalog-with-reference`. Because every product now carries a rule, the flat price is never reached — a shopper selecting a ৳160 method is charged the matched place's ৳80, so the requirement describes an assignment that no longer decides anything and actively misleads the shopper.

**Migration**: Shipment tracking is preserved verbatim by "Shipment is tracked per order" above; only the `ShippingMethod` assignment is dropped. Callers stop sending a shipping method identifier at checkout and read the delivery amount, delivery days and collection option from the quote instead. Merchants who priced by geography through several methods express the same thing as places on one shipping rule.
