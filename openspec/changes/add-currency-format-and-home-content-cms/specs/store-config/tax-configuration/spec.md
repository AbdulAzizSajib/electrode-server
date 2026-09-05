## Purpose

Establishes that named Tax Rules are the sole source of tax on an order, so that a merchant reading their Tax Rules list is reading every tax their shop charges, with no second rate configured elsewhere.

## ADDED Requirements

### Requirement: Tax comes only from an assigned Tax Rule

The system SHALL derive the tax on an order line solely from the Tax Rule assigned to that line's product. No other stored value SHALL contribute tax to an order.

#### Scenario: A product with a percentage rule

- **GIVEN** a product assigned a Tax Rule of 15%
- **WHEN** it is ordered at a charged price of 1000
- **THEN** 150 of tax is charged on that line

#### Scenario: A product with a flat rule

- **GIVEN** a product assigned a flat Tax Rule of 20
- **WHEN** two units are ordered
- **THEN** 40 of tax is charged on that line

### Requirement: A product with no Tax Rule is untaxed

The system SHALL charge zero tax on an order line whose product has no Tax Rule assigned.

#### Scenario: An untagged product is ordered

- **GIVEN** a product with no Tax Rule assigned
- **WHEN** it is ordered
- **THEN** its line contributes zero to the order's tax
- **AND** the order's total is its subtotal plus shipping, less any discount

#### Scenario: A mixed order

- **GIVEN** an order containing one product with a 15% rule and one with no rule
- **WHEN** the order is priced
- **THEN** tax is charged on the first line only

### Requirement: No shop-wide fallback tax rate exists

The system SHALL NOT offer, store, or apply a shop-wide default tax rate. The admin panel SHALL NOT present a field for one, and the settings API SHALL NOT accept one.

#### Scenario: A merchant looks for a shop-wide rate

- **WHEN** a merchant opens Store Settings
- **THEN** no shop-wide tax rate field is shown
- **AND** the page directs them to the Tax Rules screen for tax configuration

#### Scenario: A client sends a shop-wide rate

- **WHEN** a settings update is submitted containing a shop-wide tax rate field
- **THEN** the field is not persisted and does not affect any order

### Requirement: Existing tax must be carried onto Tax Rules before the fallback goes

Where a shop currently charges tax through a shop-wide rate rather than through Tax Rules, that tax SHALL be reproduced as a Tax Rule and assigned to the affected products before the shop-wide rate is withdrawn. Withdrawing it without that step SHALL be understood as making those products untaxed.

#### Scenario: A shop with a non-zero shop-wide rate

- **GIVEN** a shop whose stored shop-wide rate is 15% and whose products carry no Tax Rule
- **WHEN** an equivalent 15% Tax Rule is created and assigned to those products before the rate is withdrawn
- **THEN** order totals after the withdrawal match those before it

#### Scenario: A shop with a zero shop-wide rate

- **GIVEN** a shop whose stored shop-wide rate is 0
- **WHEN** the rate is withdrawn
- **THEN** no order total changes and no Tax Rule needs to be created
