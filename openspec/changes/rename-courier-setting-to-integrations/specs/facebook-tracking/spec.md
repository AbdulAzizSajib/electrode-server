## Purpose

Shop-wide Meta Pixel and Conversions API measurement: which events fire and from where, how the browser
and server paths are reconciled into a single conversion, how the shop-wide pixel coexists with the pixel
a landing page already carries, and the standing rule that a measurement failure never becomes a
shopper-visible failure. It exists so a merchant can measure ads across the whole storefront, not only on
campaign pages, and act on numbers that are not inflated.

## ADDED Requirements

### Requirement: The shop has a shop-wide Meta Pixel

The system SHALL allow an OWNER or ADMIN to configure one Meta Pixel for the whole storefront. When
enabled and configured, the storefront SHALL load the pixel on storefront pages and report a page view.

#### Scenario: Pixel configured and enabled

- **WHEN** a shopper loads a storefront page while the pixel integration is enabled with a pixel id
- **THEN** the pixel loads and a page view is reported

#### Scenario: Pixel not configured

- **WHEN** no pixel id is stored, or the integration is disabled
- **THEN** no pixel script and no tracking request is emitted

#### Scenario: Pixel id is rejected

- **WHEN** an OWNER or ADMIN submits a pixel id that is not a plain numeric identifier
- **THEN** the save is refused with a message naming the expected format, and nothing is stored

#### Scenario: Merchant input cannot become markup

- **WHEN** the stored pixel id is rendered into the page
- **THEN** it appears only as a quoted identifier and cannot introduce a tag, a URL, or a script body

### Requirement: A landing page's own pixel takes precedence

Where a landing page carries its own pixel, that pixel SHALL be the one used for that page, and the
shop-wide pixel MUST NOT also fire there. A single visit MUST NOT report the same event twice.

#### Scenario: Landing page with its own pixel

- **WHEN** a visitor loads a landing page that has its own pixel id
- **THEN** only that landing page's pixel fires, and the shop-wide pixel does not

#### Scenario: Landing page without its own pixel

- **WHEN** a visitor loads a landing page that has no pixel id of its own and the shop-wide pixel is enabled
- **THEN** the shop-wide pixel fires for that page

#### Scenario: Purchase on a landing page

- **WHEN** an order is completed from a landing page
- **THEN** exactly one purchase event is reported, to exactly one pixel

### Requirement: Purchases are reported

A completed order SHALL be reported as a purchase with its order value and currency.

#### Scenario: Order completed on the storefront

- **WHEN** a shopper completes an order and reaches the confirmation
- **THEN** a purchase event carrying the order's value and currency is reported

#### Scenario: Purchase reporting is blocked in the browser

- **WHEN** the pixel script is blocked or has not loaded when an order completes
- **THEN** the confirmation renders normally and no error is shown to the shopper

### Requirement: One order is one conversion, however many paths report it

When both the browser pixel and the server-side Conversions API report the same order, the two reports
SHALL carry the same event identifier so that Meta records one conversion rather than two. The identifier
MUST be stable for a given order and MUST NOT be reused across orders.

#### Scenario: Both paths report one order

- **WHEN** an order is reported by both the browser pixel and the Conversions API
- **THEN** both reports carry the same event identifier for that order

#### Scenario: Only one path reports

- **WHEN** the browser pixel is blocked and only the server reports the order
- **THEN** the server's report still carries that order's event identifier and the conversion is counted once

#### Scenario: Two orders

- **WHEN** two separate orders are reported
- **THEN** they carry different event identifiers

#### Scenario: The confirmation is reloaded

- **WHEN** a shopper reloads the order confirmation page
- **THEN** any repeated purchase report carries the same event identifier as the original, so no extra conversion is recorded

### Requirement: The Conversions API reports purchases server-side

The system SHALL allow an OWNER or ADMIN to configure a Conversions API access token and SHALL report
completed orders to Meta from the server when it is enabled and configured. The access token is a secret
and SHALL be handled under the same disclosure rules as courier credentials.

#### Scenario: CAPI configured and enabled

- **WHEN** an order is created while the Conversions API integration is enabled and configured
- **THEN** a purchase event for that order is sent to Meta from the server

#### Scenario: CAPI not configured

- **WHEN** an order is created while the integration is disabled or has no access token
- **THEN** no server-side event is sent and the order completes normally

#### Scenario: Meta is unreachable or rejects the event

- **WHEN** the server-side event fails for any reason
- **THEN** the order is still created and confirmed to the shopper, and the failure is logged rather than surfaced

#### Scenario: Order creation is never delayed by measurement

- **WHEN** the Conversions API call is slow
- **THEN** the order response is not held waiting for it

#### Scenario: Access token is never disclosed

- **WHEN** the integrations listing or the public store settings are read
- **THEN** the access token value does not appear in the response

### Requirement: Conversions API test mode is explicit

The system SHALL support sending Conversions API events in Meta's test mode, and SHALL require a test
event code whenever test mode is on.

#### Scenario: Test mode enabled with a code

- **WHEN** test mode is enabled and a test event code is stored
- **THEN** server-side events carry that test event code

#### Scenario: Test mode enabled without a code

- **WHEN** an OWNER or ADMIN enables test mode without supplying a test event code
- **THEN** the save is refused with a message saying the code is required

#### Scenario: Test mode disabled

- **WHEN** test mode is off
- **THEN** server-side events carry no test event code, whether or not one is stored
