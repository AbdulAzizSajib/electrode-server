## Purpose

Gives the store a single, typed source of truth for site-wide configuration (currency, tax rate, shipping threshold, contact info) instead of hardcoding these values in application code.

## ADDED Requirements

### Requirement: Exactly one store settings row exists
The system SHALL maintain exactly one `StoreSetting` row at all times (a singleton), never zero and never more than one.

#### Scenario: Settings are read before any admin has configured them
- **WHEN** the store settings are read for the first time, before any admin has explicitly changed them
- **THEN** a `StoreSetting` row already exists with sensible defaults (e.g. currency `BDT`, tax rate `0`)

#### Scenario: Admin updates settings
- **WHEN** an admin changes the store's currency, tax rate, free-shipping threshold, or contact info
- **THEN** the single `StoreSetting` row is updated in place — no second row is ever created

### Requirement: Tax is a single flat rate, not per-region or per-category rules
The store SHALL apply one flat default tax rate percentage from `StoreSetting` to orders. Per-region or per-product-category tax rules are explicitly out of scope for this requirement.

#### Scenario: Order tax is computed from the flat rate
- **WHEN** an order's tax amount is computed
- **THEN** it uses `StoreSetting.defaultTaxRatePercent` applied to the taxable subtotal, with no region- or category-specific override

### Requirement: The store operates in a single configured currency
The store SHALL display and transact in exactly one currency at a time, as configured in `StoreSetting`. Multi-currency (multiple currencies active simultaneously, e.g. per-customer currency selection) is explicitly out of scope.

#### Scenario: Currency is read from settings, not hardcoded
- **WHEN** a price is displayed anywhere in the storefront or admin panel
- **THEN** the currency code/symbol shown comes from `StoreSetting`, not a hardcoded value in application code
