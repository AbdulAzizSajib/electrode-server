## ADDED Requirements

### Requirement: Catalog display settings carry the large-screen product grid column count

An OWNER/ADMIN SHALL be able to set how many product cards a full-width product grid shows across on a large screen, chosen from exactly 4, 5 or 6. The value SHALL be part of the public settings payload and SHALL default to 6, so a store that never set it behaves as before.

#### Scenario: Admin chooses four columns

- **WHEN** an OWNER/ADMIN saves catalog display settings with the column count set to 4
- **THEN** the change is persisted
- **AND** both the public and admin settings reads report 4, with every other catalog display flag unchanged

#### Scenario: Guest storefront receives the column count

- **WHEN** an unauthenticated request reads the public store settings
- **THEN** the response's catalog display settings carry the column count

#### Scenario: A store that never set the column count

- **WHEN** the public settings are read for a store whose catalog display settings were saved before the column count existed, or never saved at all
- **THEN** the column count is reported as 6
- **AND** the other catalog display flags keep their stored values

#### Scenario: A column count outside the allowed set is rejected

- **WHEN** an OWNER/ADMIN submits a column count of 3, 7, 4.5, `"5"` or any other value that is not exactly 4, 5 or 6
- **THEN** the request is rejected with a validation error and no settings are changed

#### Scenario: The column count is required on a catalog display save

- **WHEN** an OWNER/ADMIN saves catalog display settings without a column count
- **THEN** the request is rejected with a validation error, as it is for any other missing catalog display key
