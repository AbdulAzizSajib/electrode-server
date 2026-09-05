## Purpose

Defines what the storefront's checkout page asks a customer for — which fields appear, which are mandatory, and which optional elements are present — and guarantees that an order is validated against the same configuration the form was rendered from.

## ADDED Requirements

### Requirement: The free-shipping-by-order-value threshold is configured with the checkout settings

The system SHALL let an authorised merchant set the order value above which delivery is free from the same admin screen that governs the rest of the checkout experience. It SHALL NOT be editable from more than one screen.

#### Scenario: Merchant sets the threshold

- **WHEN** a merchant enters a free-shipping threshold on the checkout settings screen and saves
- **THEN** an order whose value is above that threshold is quoted with no delivery charge
- **AND** an order below it is quoted the delivery charge its shipping rule specifies

#### Scenario: Merchant looks for it under store settings

- **WHEN** a merchant opens Store Settings
- **THEN** no free-shipping threshold field is shown there
- **AND** the page directs them to the checkout settings screen

#### Scenario: Saving the threshold leaves the other checkout settings alone

- **WHEN** a merchant changes only the free-shipping threshold and saves
- **THEN** the per-field visibility and requiredness settings, the coupon, note and guest switches, and the pre-submit notice are all unchanged

### Requirement: Clearing the threshold withdraws the offer

The system SHALL treat an empty threshold as "free shipping by order value is not offered", distinct from a threshold of zero, which would make every order's delivery free. A merchant who has set a threshold SHALL be able to clear it again.

#### Scenario: Merchant clears a previously set threshold

- **GIVEN** a shop with a free-shipping threshold of 5000
- **WHEN** the merchant empties the field and saves
- **THEN** the stored threshold is cleared
- **AND** an order of any value is quoted its full delivery charge

#### Scenario: Merchant sets the threshold to zero

- **WHEN** a merchant sets the threshold to 0 and saves
- **THEN** every order qualifies for free delivery
- **AND** this is distinguishable in the admin panel from having no threshold at all

### Requirement: Free shipping waives delivery only

The system SHALL apply the order-value threshold to the delivery charge alone. A customer who chooses to collect in person SHALL still be charged the collection price their pickup location specifies.

#### Scenario: A qualifying order chooses collection

- **GIVEN** an order above the free-shipping threshold
- **WHEN** the customer selects collection in person
- **THEN** the collection price is charged in full and is not waived
