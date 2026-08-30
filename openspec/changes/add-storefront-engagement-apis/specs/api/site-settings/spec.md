## Purpose

Serves the storefront's store-wide presentation configuration — branding, navigation, footer link columns, social links, announcement bar, newsletter copy and public contact details — so the header and footer render from data rather than hardcoded frontend constants, while keeping operational settings admin-only.

## ADDED Requirements

### Requirement: Public settings are readable without authentication

An unauthenticated request SHALL be able to read the storefront presentation settings. The response SHALL contain only storefront-safe fields and SHALL NOT expose operational or financial configuration.

#### Scenario: Guest storefront loads the header and footer

- **WHEN** an unauthenticated request reads the public store settings
- **THEN** the response is 200 and contains the branding, navigation, footer, social, announcement-bar, newsletter and public contact fields needed to render the header and footer

#### Scenario: Operational settings are withheld from the public payload

- **WHEN** an unauthenticated request reads the public store settings
- **THEN** admin-only configuration such as `defaultTaxRatePercent` is absent from the response body, even though it exists on the underlying settings record

#### Scenario: Admin read still returns the complete record

- **WHEN** an OWNER/ADMIN reads the store settings through the authenticated endpoint
- **THEN** the response contains every settings field, including both the operational fields and the storefront presentation fields

### Requirement: Store settings always resolve to a populated singleton

A read of store settings SHALL always succeed with a usable payload, whether or not an administrator has ever saved settings. The system SHALL NOT return an empty or partially-null presentation payload that would leave a storefront header or footer blank.

#### Scenario: Reading settings on a fresh installation

- **WHEN** the public settings are read before any administrator has saved settings
- **THEN** the response is 200 and every presentation field carries a non-empty default value

#### Scenario: A cleared optional field falls back to its default

- **WHEN** an administrator clears the navigation menu and the public settings are then read
- **THEN** the response still returns a usable navigation structure rather than a null or empty value

### Requirement: The navigation menu is admin-editable and supports one level of nesting

An OWNER/ADMIN SHALL be able to define the storefront's main navigation as an ordered list of entries, each with a label and a target link, where an entry MAY carry an ordered list of child entries. Nesting SHALL be limited to one level.

#### Scenario: Admin defines a nested navigation entry

- **WHEN** an OWNER/ADMIN saves a navigation entry that has child entries
- **THEN** the entry and its children are persisted in the submitted order and returned in that order by both the public and admin reads

#### Scenario: Navigation nested more than one level is rejected

- **WHEN** an OWNER/ADMIN submits a navigation entry whose child itself has children
- **THEN** the request is rejected with a validation error and no settings are changed

#### Scenario: A navigation entry missing a required field is rejected

- **WHEN** an OWNER/ADMIN submits a navigation entry with no label or no link target
- **THEN** the request is rejected with a validation error and no settings are changed

### Requirement: Footer link columns are admin-editable and carry link targets

An OWNER/ADMIN SHALL be able to define the footer as an ordered list of columns, each with a heading and an ordered list of links. Every footer link SHALL carry both a display label and a target, so that no footer link renders as a dead link.

#### Scenario: Admin defines footer columns

- **WHEN** an OWNER/ADMIN saves footer columns each containing labelled links with targets
- **THEN** the columns, their headings and their links are persisted and returned in the submitted order

#### Scenario: A footer link without a target is rejected

- **WHEN** an OWNER/ADMIN submits a footer link that has a label but no target
- **THEN** the request is rejected with a validation error and no settings are changed

### Requirement: Social links are stored as a platform-identified list

An OWNER/ADMIN SHALL be able to define social media links as a list of entries, each identifying a platform and a URL. The platform identifier SHALL be constrained to the set the storefront can render an icon for.

#### Scenario: Admin saves a social link

- **WHEN** an OWNER/ADMIN saves a social entry for a supported platform with a valid URL
- **THEN** the entry appears in both the public and admin settings reads

#### Scenario: An unsupported platform is rejected

- **WHEN** an OWNER/ADMIN submits a social entry for a platform the storefront cannot render
- **THEN** the request is rejected with a validation error and no settings are changed

#### Scenario: A malformed social URL is rejected

- **WHEN** an OWNER/ADMIN submits a social entry whose URL is not a valid URL
- **THEN** the request is rejected with a validation error and no settings are changed

### Requirement: The announcement bar can be toggled without losing its content

An OWNER/ADMIN SHALL be able to enable or disable the storefront announcement bar independently of its text and links, so that disabling it does not require re-entering its content later.

#### Scenario: Disabling the announcement bar

- **WHEN** an OWNER/ADMIN disables the announcement bar
- **THEN** the public settings report it as disabled while its previously saved text and links remain stored and are returned unchanged when it is re-enabled

### Requirement: Settings changes are audit-logged

Every successful mutation of store settings SHALL record an audit entry attributing the change to the acting user and capturing the prior and new values.

#### Scenario: Admin updates the site branding

- **WHEN** an OWNER/ADMIN updates the site name
- **THEN** the settings are updated and an audit entry is recorded identifying the acting user, the settings entity, and the before and after values

#### Scenario: A rejected update writes no audit entry

- **WHEN** a settings update is rejected for failing validation
- **THEN** no audit entry is recorded and the stored settings are unchanged
