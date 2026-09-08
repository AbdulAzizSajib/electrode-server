## ADDED Requirements

### Requirement: Catalog display features are admin-controlled and publicly readable

An OWNER/ADMIN SHALL be able to declare, per store, whether the storefront offers a wishlist, whether it offers product comparison, and whether it offers a quick preview of a product from a listing. Each SHALL be settable independently of the others.

These flags SHALL be part of the storefront-safe public payload, because the storefront must know which features to present before any shopper session exists and on every page it renders.

Each flag SHALL default to enabled, and a settings record that has never carried them SHALL read as enabled. Introducing these flags therefore MUST NOT change the behaviour of any store that has not configured them.

Turning a feature off SHALL affect only what the storefront is told to present. It MUST NOT delete or make unreadable any data a shopper has already saved under that feature, so that re-enabling it restores what was there.

#### Scenario: Admin disables product comparison

- **WHEN** an OWNER/ADMIN saves settings declaring comparison disabled
- **THEN** the change is persisted
- **AND** both the public and admin settings reads report comparison as disabled, with the wishlist and quick view flags unchanged

#### Scenario: Guest storefront receives the flags

- **WHEN** an unauthenticated request reads the public store settings
- **THEN** the response carries all three catalog display flags

#### Scenario: A store that never configured the flags

- **WHEN** the public settings are read for a store whose settings record has no catalog display configuration
- **THEN** all three flags are reported as enabled

#### Scenario: Saved data survives a feature being turned off

- **WHEN** a feature is turned off and later turned back on
- **THEN** the items shoppers had saved under it before it was turned off are still readable

#### Scenario: A flag that is not a true/false value is rejected

- **WHEN** an OWNER/ADMIN submits a catalog display flag that is not a boolean
- **THEN** the request is rejected with a validation error and no settings are changed

#### Scenario: Catalog flags save independently of other settings

- **WHEN** an OWNER/ADMIN saves only the catalog display flags
- **THEN** the checkout configuration, theme, and navigation settings are left as they were
