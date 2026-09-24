## ADDED Requirements

### Requirement: Whether the drawer opens by itself after an add is a merchant setting

The storefront SHALL offer a setting governing whether the cart drawer opens by itself when a product is added to the cart. The setting SHALL default to opening it, so a shop that never changes it behaves as it did before the setting existed.

While the setting is on, adding a product from anywhere that adds to the cart — a listing card, a preview over a listing, a product's own page, or moving something across from a saved list — SHALL open the drawer.

While the setting is off, none of those SHALL open the drawer. The shopper SHALL remain where they were, and SHALL still be told that what they added was added.

The setting SHALL govern only the drawer opening **by itself**. Every way a shopper opens the cart deliberately SHALL continue to open it in both positions of the setting, and SHALL NOT be removed, hidden or disabled by it.

A shopper SHALL be able to reach their cart in both positions of the setting without adding anything further.

#### Scenario: Auto-open on, adding from a listing

- **WHEN** the setting is on and a shopper adds a product from a listing
- **THEN** the cart drawer opens

#### Scenario: Auto-open off, adding from a listing

- **WHEN** the setting is off and a shopper adds a product from a listing
- **THEN** the cart drawer does not open
- **AND** the shopper stays on the listing they were browsing
- **AND** the shopper is told the product was added

#### Scenario: Auto-open off, opening the cart deliberately

- **WHEN** the setting is off and a shopper acts on a control whose purpose is to show the cart
- **THEN** the cart drawer opens

#### Scenario: Auto-open off, adding from a preview over a listing

- **WHEN** the setting is off and a shopper chooses a variant in a preview and adds it
- **THEN** the preview closes
- **AND** the cart drawer does not open

#### Scenario: A shop that has never changed the setting

- **WHEN** a shop's settings carry no value for this setting
- **THEN** the drawer opens after an add, as it did before the setting existed

#### Scenario: Settings cannot be read

- **WHEN** the shop's settings cannot be read
- **THEN** the drawer opens after an add, rather than the shopper being left with no indication their cart changed
