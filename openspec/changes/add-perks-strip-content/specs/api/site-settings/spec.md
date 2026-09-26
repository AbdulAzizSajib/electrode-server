## ADDED Requirements

### Requirement: The home page's perks strip is admin-editable and publicly readable

An OWNER/ADMIN SHALL be able to record, per store, the columns of the home page's perks strip — the band of short promises beneath the product rows. Each column SHALL carry an icon name, a title and a short supporting line, and the recorded order SHALL be the order the storefront renders them in.

The columns SHALL be part of the storefront-safe public payload, because the home page renders the band before any shopper session exists and from the settings payload it already holds.

Every column SHALL require all three of its fields. A column missing any of them SHALL be rejected, because the band is a row of aligned columns and a partially filled one cannot be rendered tidily. Clearing a column's fields is therefore NOT how a merchant removes it: removing a column means removing the entry, and removing the band means switching its home-page section off.

The number of columns SHALL be bounded. A save carrying more than the limit SHALL be rejected with a validation error naming the limit.

An icon SHALL be recorded as a name the storefront resolves, not as an uploaded image, so that the mark is tinted with the band's own colour and follows a change of brand colour without being re-cut.

The setting SHALL default to **unset**, and a settings record that has never carried it SHALL read as the columns the storefront rendered before the setting existed. Introducing this setting therefore MUST NOT change what any existing store's visitors see, and MUST NOT require a data migration.

An **empty** list SHALL be storable and SHALL be served as empty. Unset and empty are different decisions — "never configured" and "deliberately cleared" — and MUST remain distinguishable: an empty list means the storefront renders no band at all, and a later read MUST NOT substitute the shipped columns for it.

Recording the columns SHALL be independent of every other setting: saving them alone MUST leave the section list, the newsletter wording, the theme and every other stored value as they were. Equally, a save that says nothing about the columns MUST leave them as they were.

Whether the band renders at all SHALL remain governed by its entry in the home-page section list, not by this setting. The two SHALL be independently expressible: a store MAY have columns recorded with the section switched off, and MUST render nothing in that case.

#### Scenario: Admin records the strip's columns

- **WHEN** an OWNER/ADMIN saves settings carrying a list of columns, each with an icon name, a title and a supporting line
- **THEN** the list is persisted in the order given
- **AND** both the public and the admin settings reads report it in that order

#### Scenario: Guest storefront receives the columns

- **WHEN** an unauthenticated request reads the public store settings
- **THEN** the response carries the perks strip's columns

#### Scenario: A store that has never configured the strip

- **WHEN** the public settings are read for a store whose settings record has no perks strip
- **THEN** the response reports the columns the storefront rendered before the setting existed, rather than an empty list

#### Scenario: A deliberately emptied strip stays empty

- **WHEN** an OWNER/ADMIN saves settings carrying an empty list of columns
- **THEN** the public settings read reports an empty list
- **AND** the shipped columns are not substituted for it on that read or any later one

#### Scenario: A column missing a field is rejected

- **WHEN** an OWNER/ADMIN submits a column with a blank icon name, title or supporting line
- **THEN** the request is rejected with a validation error and no settings are changed

#### Scenario: Too many columns are rejected

- **WHEN** an OWNER/ADMIN submits more columns than the strip allows
- **THEN** the request is rejected with a validation error naming the limit and no settings are changed

#### Scenario: An unknown field on a column is rejected

- **WHEN** an OWNER/ADMIN submits a column carrying a field the strip does not define
- **THEN** the request is rejected rather than the field being silently dropped

#### Scenario: A save that does not mention the strip leaves it alone

- **WHEN** an OWNER/ADMIN saves settings that say nothing about the perks strip
- **THEN** whatever columns were recorded before are still recorded afterwards

#### Scenario: The strip saves independently of other settings

- **WHEN** an OWNER/ADMIN saves only the perks strip's columns
- **THEN** the home-page section list, the newsletter wording, the theme and the navigation settings are left as they were

#### Scenario: Columns are kept while the section is switched off

- **WHEN** an OWNER/ADMIN switches the perks section off in the home-page section list
- **THEN** the recorded columns are unchanged
- **AND** switching the section back on renders exactly those columns again
