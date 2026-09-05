## Purpose

Defines how a monetary amount is written throughout the system — the currency code, its symbol, whether that symbol leads or trails the amount, and how many decimal places appear — and guarantees that the storefront, the admin panel and the server all render the same amount the same way.

## ADDED Requirements

### Requirement: A merchant configures how money is written

The system SHALL let an authorised merchant configure four properties of monetary presentation: the currency code, the currency symbol, the symbol's position relative to the amount (before or after), and the number of decimal places shown. All four SHALL be editable together in one place in the admin panel.

#### Scenario: Merchant changes the symbol position

- **WHEN** a merchant sets the symbol position to "after the amount" and saves
- **THEN** an amount of 1200 renders as `1,200.00 ৳` rather than `৳1,200.00`

#### Scenario: Merchant changes the decimal places

- **WHEN** a merchant sets decimal places to 0 and saves
- **THEN** an amount of 1200.5 renders as `৳1,201` with no decimal separator

#### Scenario: Merchant changes the symbol

- **WHEN** a merchant changes the currency symbol from `৳` to `$` and saves
- **THEN** every price in the storefront and the admin panel renders with `$`

### Requirement: Decimal places are between 0 and 4

The system SHALL accept a decimal-place count of 0, 1, 2, 3 or 4 and SHALL reject anything outside that range. The range covers every currency in circulation, from those with no minor unit to those with three, plus one for headroom.

#### Scenario: A count outside the range is rejected

- **WHEN** a save is attempted with decimal places set to 5, to -1, or to a non-integer
- **THEN** the save is rejected with a message naming the accepted range
- **AND** the previously stored value is unchanged

### Requirement: One rendering, honoured by every surface

The system SHALL render a given amount identically wherever it appears — the storefront, the admin panel, and any monetary value the server writes into a message it returns. A merchant reading a total in the admin panel and a shopper reading the same total on the storefront SHALL see the same string.

#### Scenario: Storefront and admin agree

- **GIVEN** a store configured with symbol `৳`, position before, 2 decimal places
- **WHEN** an order totalling 1200 is viewed on the storefront and in the admin panel
- **THEN** both show `৳1,200.00`

#### Scenario: A server message names an amount

- **WHEN** the server rejects a request with a message that quotes a monetary amount
- **THEN** that amount is written using the merchant's configured format

### Requirement: Amounts are grouped by thousands

The system SHALL separate thousands when rendering a monetary amount, so a four-digit or larger amount is readable at a glance.

#### Scenario: A large amount is grouped

- **WHEN** an amount of 1234567.89 is rendered with 2 decimal places
- **THEN** it reads `1,234,567.89` rather than `1234567.89`

### Requirement: Decimal places affect presentation only

The number of decimal places SHALL govern only how an amount is displayed. It SHALL NOT change how any amount is stored, computed, totalled or charged. The admin panel SHALL state this beside the setting, so a merchant who reduces decimal places understands why displayed line items may no longer visibly sum to the displayed total.

#### Scenario: Zero decimals does not change what is charged

- **GIVEN** decimal places set to 0
- **WHEN** an order totalling 1200.50 is placed
- **THEN** the amount stored against the order and captured from the customer is 1200.50
- **AND** the displayed total reads `৳1,201`

#### Scenario: More decimals than are stored

- **GIVEN** decimal places set to 4
- **WHEN** an amount of 1200.5 is rendered
- **THEN** it reads `৳1,200.5000`, with the trailing digits carrying no stored precision

### Requirement: An unconfigured store still renders money

The system SHALL render monetary amounts using documented defaults when the currency settings have never been saved, or when the settings cannot be read. A failure to load settings SHALL NOT leave an amount unformatted, blank, or symbol-less.

#### Scenario: Settings are unreachable

- **WHEN** the storefront cannot reach the settings endpoint
- **THEN** prices continue to render using the default symbol, position and decimal places
- **AND** no price renders as a bare number or an empty string

### Requirement: Exported data stays numeric

The system SHALL write monetary values in machine-readable exports as bare decimal numbers, without a currency symbol or thousands separators, so that a spreadsheet reads the column as numeric.

#### Scenario: A report is exported

- **WHEN** a merchant exports a report containing monetary columns
- **THEN** each monetary cell contains a plain decimal such as `1200.50`
- **AND** opening the export in a spreadsheet yields a numeric column that can be summed
