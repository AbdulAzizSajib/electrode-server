## Purpose

Defines what the storefront's checkout page asks a customer for — which fields appear, which are mandatory, and which optional elements (coupon box, order note, guest ordering, pre-submit notice) are present — and guarantees that an order is validated against the same configuration the form was rendered from.

## ADDED Requirements

### Requirement: A merchant controls which checkout fields are shown and which are required

The system SHALL let an authorised merchant configure, per checkout field, whether it is shown to the customer and whether it is mandatory. The configurable set SHALL be exactly the fields the checkout collects: customer name, mobile number, address, apartment/floor, city, and postal code.

#### Scenario: Merchant hides a field

- **WHEN** a merchant turns off "Show on checkout" for postal code and saves
- **THEN** the checkout page no longer renders a postal code input
- **AND** an order placed without a postal code is accepted

#### Scenario: Merchant makes a shown field optional

- **WHEN** a merchant leaves city shown but turns off "Required" and saves
- **THEN** the checkout page renders the city input marked as optional
- **AND** an order submitted with an empty city is accepted

#### Scenario: Merchant makes an optional field required

- **WHEN** a merchant turns on "Required" for apartment/floor and saves
- **THEN** the checkout page refuses to submit while that input is empty, naming the field
- **AND** an order submitted without it is rejected with a message identifying the field

### Requirement: A hidden field is never simultaneously required

The system SHALL reject a configuration in which a field is marked required while not being shown, because it describes a checkout that can never be completed.

#### Scenario: Required is set on a hidden field

- **WHEN** a save is attempted with address hidden and required at the same time
- **THEN** the save is rejected and no part of the configuration is persisted
- **AND** the response identifies which field is contradictory

#### Scenario: Hiding a field clears its required flag

- **WHEN** a merchant turns off "Show on checkout" for a field that was required
- **THEN** the admin UI clears that field's "Required" checkbox in the same interaction, so the contradictory state cannot be submitted

### Requirement: Mobile number can be neither hidden nor made optional

The system SHALL treat the customer's mobile number as a floor that configuration cannot remove. Guest order lookup and the per-phone cash-on-delivery abuse limit are both keyed on the phone number, so an order without one cannot be tracked by its owner or rate-limited.

#### Scenario: Merchant attempts to hide mobile number

- **WHEN** a save is attempted with mobile number not shown, or shown but not required
- **THEN** the save is rejected with a message explaining that order tracking and COD limits depend on it

#### Scenario: Admin UI presents the floor

- **WHEN** a merchant opens the checkout settings page
- **THEN** the mobile number row's two checkboxes are shown checked and locked, with a note explaining why they cannot be changed

### Requirement: The server validates an order against the stored configuration

The system SHALL apply the stored checkout configuration when validating a submitted order, so that a field a merchant made optional is genuinely optional at the API and a field a merchant made required is genuinely enforced. Client-side validation SHALL NOT be the only gate.

#### Scenario: Order omits a field the merchant made optional

- **WHEN** an order is submitted without a customer name, and the stored configuration marks customer name optional
- **THEN** the order is accepted

#### Scenario: Order omits a field that is still required

- **WHEN** an order is submitted without an address, and the stored configuration marks address required
- **THEN** the order is rejected, and no stock is reserved and no order record is created

#### Scenario: Request bypasses the storefront form

- **WHEN** an order is submitted directly to the API with fields the current configuration marks required left empty
- **THEN** it is rejected on the same terms as one submitted through the form

### Requirement: Guest checkout can be turned off, and the server enforces it

The system SHALL let a merchant require sign-in to place an order. When guest checkout is off, the restriction SHALL be enforced by the server and not only by the storefront.

#### Scenario: Signed-out shopper reaches checkout while guest checkout is off

- **WHEN** a shopper with no session opens the checkout page and guest checkout is off
- **THEN** they are directed to sign in, with their cart preserved and a return path back to checkout

#### Scenario: Guest order submitted directly while guest checkout is off

- **WHEN** an order is submitted with no customer session and guest checkout is off
- **THEN** the request is rejected as unauthorised and no order is created

#### Scenario: Guest checkout is on

- **WHEN** a shopper with no session places an order and guest checkout is on
- **THEN** the order is placed under the existing guest rules, unchanged

### Requirement: The coupon code box is shown on both cart and checkout, or on neither

The system SHALL render a coupon entry box on the cart page and the checkout page when the coupon setting is on, and on neither when it is off. A single setting SHALL govern both, so the two surfaces cannot disagree about whether coupons are offered.

#### Scenario: Coupon box enabled

- **WHEN** the coupon setting is on
- **THEN** both the cart page and the checkout page render a coupon entry box
- **AND** a code applied on one surface is reflected in the order summary on the other

#### Scenario: Coupon box disabled

- **WHEN** the coupon setting is off
- **THEN** neither page renders a coupon entry box

#### Scenario: A coupon is already applied when the box is turned off

- **WHEN** the coupon setting is turned off while a shopper has a coupon applied to their cart
- **THEN** the existing discount continues to be honoured and remains visible in the order summary, and only the entry box is absent

### Requirement: The order note box can be hidden

The system SHALL let a merchant hide the order note input. Hiding it SHALL affect only what the checkout collects; it SHALL NOT cause an order that carries a note to be rejected.

#### Scenario: Order note hidden

- **WHEN** the order note setting is off
- **THEN** the checkout page renders no note input and submits no note

#### Scenario: Order carrying a note while the box is hidden

- **WHEN** an order is submitted with a note while the note setting is off
- **THEN** the order is accepted and the note is stored, so an older client or an integration is not broken by a presentation setting

### Requirement: A merchant-authored notice renders above the Place Order button

The system SHALL render merchant-supplied text immediately above the checkout's Place Order button, and SHALL render nothing when that text is empty.

#### Scenario: Notice is set

- **WHEN** a merchant saves notice text and a shopper opens checkout
- **THEN** that text appears directly above the Place Order button

#### Scenario: Notice is empty

- **WHEN** the notice text is empty or unset
- **THEN** no notice element is rendered, leaving no empty container or stray spacing above the button

### Requirement: An unconfigured store behaves exactly as it does today

The system SHALL apply built-in defaults when checkout has never been configured, and those defaults SHALL reproduce the checkout's current behaviour: name, mobile number, address and city shown and required; apartment/floor and postal code shown and optional; order note shown; guest checkout allowed; no notice.

#### Scenario: Store has never saved checkout settings

- **WHEN** a shopper opens checkout on a store with no stored checkout configuration
- **THEN** the page presents the same fields, with the same requiredness, as before this change

#### Scenario: Configuration is unreadable

- **WHEN** the checkout configuration cannot be read or is malformed
- **THEN** the built-in defaults are used and checkout remains usable rather than failing to render

### Requirement: Checkout configuration is publicly readable but only editable by authorised staff

The system SHALL expose the checkout configuration to unauthenticated storefront reads, since the checkout page needs it before a shopper has any session. The system SHALL restrict changes to store owners and administrators.

#### Scenario: Storefront reads the configuration

- **WHEN** an unauthenticated request reads the public store settings
- **THEN** the checkout configuration is included

#### Scenario: Non-administrator attempts a change

- **WHEN** a request from a staff member who is neither an owner nor an administrator attempts to change the checkout configuration
- **THEN** it is rejected and the stored configuration is unchanged

#### Scenario: Change is recorded

- **WHEN** an authorised merchant saves a checkout configuration change
- **THEN** the change is recorded in the audit trail with the previous and new values
