## ADDED Requirements

### Requirement: A homepage section entry is identified by key and instance, not by key alone

The homepage section configuration SHALL permit the promo-banner section key to appear more than once, each occurrence naming a distinct promo banner group. Every other section key SHALL continue to appear at most once. Each occurrence SHALL carry its own enabled flag and its own position in the merchant's ordering.

#### Scenario: Two promo strips in one configuration

- **WHEN** a merchant's stored configuration holds two promo-banner entries naming two different groups
- **THEN** both are served, each in its stored position, and neither is deduplicated away

#### Scenario: One strip on, one off

- **WHEN** a merchant disables one promo-banner entry and leaves the other enabled
- **THEN** only the enabled group's strip renders on the storefront, and the disabled entry is preserved in the configuration

#### Scenario: Duplicate entries naming the same group

- **WHEN** a stored configuration holds two promo-banner entries naming the same group
- **THEN** the first occurrence is kept and the second is dropped, matching the existing first-occurrence-wins rule for duplicate keys

#### Scenario: A non-promo key still deduplicates

- **WHEN** a stored configuration holds two entries for a fixed section key such as the hero
- **THEN** the first occurrence is kept and the second is dropped

### Requirement: Section reconciliation drops entries naming a group that no longer exists

Reconciliation of a stored homepage configuration SHALL drop any promo-banner entry whose named group has been deleted, and SHALL insert a promo-banner entry, enabled, for any group that exists but is named by no entry — so a group created outside the homepage editor still appears on the page.

#### Scenario: Group deleted after the configuration was saved

- **WHEN** a merchant deletes a group that their stored configuration still names
- **THEN** that entry is dropped from the served configuration and the storefront renders no strip for it, with no error

#### Scenario: Group created but not yet placed

- **WHEN** a merchant creates a group and has not opened the homepage sections editor
- **THEN** the served configuration carries an enabled entry for that group, positioned with the other promo entries

#### Scenario: Entry with a missing or malformed group identifier

- **WHEN** a stored promo-banner entry carries no group identifier, or one that is not a string
- **THEN** the entry is dropped rather than served as an unrenderable section

### Requirement: Existing promotional banners are preserved when groups are introduced

Introducing promo banner groups SHALL NOT change what an existing store's homepage renders. Every promotional banner already on file SHALL be carried into a group, and every stored configuration already carrying a promo-banner entry SHALL keep that entry pointing at the carried-over group, in its existing position with its existing enabled state.

#### Scenario: Store with the original three-tile strip

- **WHEN** a store holding three promotional banners and a configuration naming the promo section is upgraded
- **THEN** it holds one group containing those three banners with the three-across layout, its configuration entry names that group in the same position, and the homepage renders exactly as before

#### Scenario: Store that had disabled the promo section

- **WHEN** an upgraded store's stored configuration had the promo section disabled
- **THEN** the carried-over entry remains disabled and no strip renders

#### Scenario: Store with no promotional banners

- **WHEN** a store holding no promotional banners is upgraded
- **THEN** no group is created for it and its homepage renders no promo strip, as before
