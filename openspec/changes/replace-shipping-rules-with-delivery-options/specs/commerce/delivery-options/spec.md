## Purpose

Lets a merchant offer a short, named list of delivery choices — delivery areas and pickup points — that a shopper picks from at checkout, so what delivery costs is a decision the shopper makes rather than something inferred from the address they typed.

## ADDED Requirements

### Requirement: A merchant configures delivery as a list of named options

The system SHALL let a merchant define an ordered list of delivery options for the store. Each option SHALL carry a name shown to the shopper, a price, an estimated number of days, and whether it is a home delivery or a pickup point. Options SHALL apply to the whole store rather than to individual products.

An option SHALL NOT carry any destination criteria. The system SHALL NOT infer, match or derive a shopper's delivery option from their address.

#### Scenario: Merchant sets up delivery areas

- **WHEN** a merchant adds two options named for their delivery areas, each with its own price, and saves
- **THEN** both are stored in the order given, and both are offered to every shopper at checkout regardless of the address they enter

#### Scenario: Merchant adds a pickup point

- **WHEN** a merchant adds an option marked as a pickup point, naming the location
- **THEN** it is stored as a collection point rather than a delivery area, and its price is what a shopper collecting there is charged

#### Scenario: Two options may share a price

- **WHEN** a merchant saves two options with different names and the same price
- **THEN** both are accepted — options are distinguished by the name the shopper reads, not by what they cost

#### Scenario: Merchant reorders the list

- **WHEN** a merchant changes the order of the options and saves
- **THEN** the checkout presents them in that order

#### Scenario: Option name is missing

- **WHEN** a save is attempted with an option that has no name
- **THEN** it is rejected, and no part of the list is changed — an unnamed option is one a shopper cannot tell apart from any other

#### Scenario: Two options share a name

- **WHEN** a save is attempted with two options carrying the same name
- **THEN** it is rejected with a message naming the duplicate, because a shopper choosing between two identically-labelled options cannot express a preference

### Requirement: Delivery options are configured in checkout settings

The system SHALL present the delivery option list in the store's checkout settings, alongside the other decisions governing what the checkout collects and offers. There SHALL NOT be a separate delivery configuration surface elsewhere in the admin, and delivery SHALL NOT be configurable per product.

#### Scenario: Merchant finds delivery configuration

- **WHEN** a merchant opens checkout settings
- **THEN** the delivery option list is editable there, together with the checkout's field, coupon and guest-checkout settings

#### Scenario: Product has no delivery configuration

- **WHEN** a merchant edits a product
- **THEN** no delivery or shipping choice is offered on the product, because delivery is a store-wide checkout decision

### Requirement: A merchant controls whether collection in person is offered

The system SHALL provide a checkout setting governing whether pickup points are offered to shoppers. When it is off, the checkout SHALL offer the delivery areas alone and SHALL NOT present any pickup choice, even when pickup points are configured. When it is on, a shopper SHALL be able to choose between having the order delivered and collecting it.

#### Scenario: Collection is turned off

- **WHEN** collection in person is off and a shopper reaches the delivery step
- **THEN** they are shown only the delivery areas, with no step asking whether they want delivery or collection

#### Scenario: Collection is turned on

- **WHEN** collection in person is on and a shopper reaches the delivery step
- **THEN** they are first asked whether they want the order delivered or will collect it, and then shown the matching list

#### Scenario: Collection is turned on with no pickup points configured

- **WHEN** collection in person is on but no option is marked as a pickup point
- **THEN** the merchant is told that no pickup points are configured, so the setting cannot be left on in a state where a shopper could choose collection and then have nothing to choose

#### Scenario: Collection is turned off while pickup points exist

- **WHEN** a merchant turns collection off without deleting their pickup points
- **THEN** the setting is saved and the pickup points are retained but not offered, so collection can be resumed later without re-entering them

### Requirement: The shopper chooses a delivery option at checkout

The system SHALL require the shopper to select one delivery option before an order can be placed, and SHALL charge exactly the price of the option they selected. Delivery SHALL be charged once per order, not once per product or per group of products.

#### Scenario: Shopper picks a delivery area

- **WHEN** a shopper selects a delivery area and the order is placed
- **THEN** the delivery charge on the order equals that option's price, whatever else is in the basket

#### Scenario: Quote matches the charge

- **WHEN** a shopper selects an option and is shown an order total before confirming
- **THEN** the delivery amount in that total is the same amount the placed order is charged

#### Scenario: Basket contents do not change the charge

- **WHEN** a shopper with several different products in the basket selects one option
- **THEN** delivery is charged once at that option's price, rather than accumulating a charge per product

#### Scenario: No option selected

- **WHEN** an order is submitted without a delivery option
- **THEN** it is refused with a message asking the shopper to choose one, and no order is created

#### Scenario: Submitted option does not exist

- **WHEN** an order is submitted naming an option that has since been deleted
- **THEN** it is refused rather than being charged a stale or zero amount, and the shopper is asked to choose again

#### Scenario: Pickup submitted while collection is off

- **WHEN** an order is submitted selecting a pickup point while collection in person is turned off
- **THEN** it is refused, so a setting a merchant has switched off cannot be reached by submitting the request directly

### Requirement: Choosing a pickup point suppresses the delivery address

The system SHALL NOT require a delivery address when the shopper has chosen to collect in person. Address fields the merchant has configured as required for delivery SHALL NOT block an order being collected, since there is nothing to deliver.

#### Scenario: Shopper collects in person

- **WHEN** a shopper selects a pickup point
- **THEN** the checkout stops asking for a delivery address, and the order is accepted without one

#### Scenario: Shopper switches back to delivery

- **WHEN** a shopper who had selected a pickup point switches to a delivery area
- **THEN** the address fields are asked for again and the merchant's required-field rules apply as normal

#### Scenario: Contact details are still required

- **WHEN** a shopper collects in person
- **THEN** the details needed to identify and reach them for the collection are still required, so a collection order can still be matched to the person arriving for it

### Requirement: The order records which option was chosen

The system SHALL record on each order the name and price of the delivery option the shopper chose, captured at the moment the order is placed, and whether it was a delivery or a collection. That record SHALL NOT change when the merchant later renames, reprices or deletes that option.

#### Scenario: Merchant renames an option after orders exist

- **WHEN** a merchant renames a delivery option
- **THEN** orders already placed continue to show the name that was current when they were placed

#### Scenario: Merchant deletes an option after orders exist

- **WHEN** a merchant deletes a delivery option
- **THEN** orders placed under it remain readable and keep showing what was chosen and charged, and no order is deleted or orphaned

#### Scenario: Merchant reprices an option

- **WHEN** a merchant changes an option's price
- **THEN** orders already placed keep the amount they were charged, and only later orders use the new price

#### Scenario: Staff view a collection order

- **WHEN** staff open an order the shopper chose to collect
- **THEN** it is identifiable as a collection and names the pickup point, so it is not dispatched to a courier by mistake

### Requirement: A store with no delivery options cannot take orders

The system SHALL refuse to price or place an order when no delivery option is configured, rather than charging nothing for delivery. The refusal SHALL identify this as a store configuration problem rather than blaming the shopper's input.

#### Scenario: Shopper reaches checkout with nothing configured

- **WHEN** a shopper reaches checkout and the store has no delivery options
- **THEN** no order can be placed, and the message says delivery has not been set up for this store

#### Scenario: Merchant empties the list

- **WHEN** a merchant attempts to save an empty delivery option list
- **THEN** it is rejected, because a store that can take orders must be able to say what delivery costs
