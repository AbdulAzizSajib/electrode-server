## ADDED Requirements

### Requirement: The browser-tab icon is admin-editable and publicly readable

An OWNER/ADMIN SHALL be able to record, per store, the address of the image a browser shows as the site's tab icon. The address SHALL be validated as a well-formed URL and rejected otherwise, exactly as the header and footer logo addresses are.

The icon address SHALL be part of the storefront-safe public payload, because the storefront must emit it in the document head of every page it renders, before any shopper session exists.

The setting SHALL default to **unset**, and a settings record that has never carried it SHALL read as unset. Unset means "no icon has been chosen" and MUST be distinguishable from "an icon has been chosen and it is blank" — introducing this setting therefore MUST NOT change what any existing store's visitors see.

An OWNER/ADMIN SHALL be able to **remove** a recorded icon and return the store to unset, not merely replace one icon with another. Because a save carrying no icon at all means "leave the icon as it is", removing one MUST have its own explicit representation, distinct from both "leave unchanged" and "set to a blank address".

Recording an icon SHALL be independent of every other setting: saving it alone MUST leave the logos, the brand display modes, the theme and every other stored value as they were.

#### Scenario: Admin records a tab icon

- **WHEN** an OWNER/ADMIN saves settings carrying a valid icon address
- **THEN** the address is persisted
- **AND** both the public and the admin settings reads report it

#### Scenario: Guest storefront receives the icon address

- **WHEN** an unauthenticated request reads the public store settings
- **THEN** the response carries the tab icon address

#### Scenario: A store that never chose an icon

- **WHEN** the public settings are read for a store whose settings record has no tab icon
- **THEN** the response reports the icon as unset rather than as an empty or invented address

#### Scenario: A malformed icon address is rejected

- **WHEN** an OWNER/ADMIN submits a tab icon address that is not a well-formed URL
- **THEN** the request is rejected with a validation error and no settings are changed

#### Scenario: Admin removes a recorded icon

- **WHEN** an OWNER/ADMIN saves settings explicitly removing the tab icon
- **THEN** the store reads as having no icon on both the public and admin reads
- **AND** every other branding value, including both logos, is unchanged

#### Scenario: A save that does not mention the icon leaves it alone

- **WHEN** an OWNER/ADMIN saves settings that say nothing about the tab icon
- **THEN** whatever icon was recorded before is still recorded afterwards

#### Scenario: The icon saves independently of other settings

- **WHEN** an OWNER/ADMIN saves only the tab icon
- **THEN** the logos, brand display modes, theme and navigation settings are left as they were

### Requirement: The newsletter signup is one of the home page's orderable sections

The newsletter signup SHALL be one of the sections the home page is composed from, so that an OWNER/ADMIN can switch it on, switch it off, and place it anywhere in the page's order — the same control they already have over every other home-page section.

Whether the newsletter is shown SHALL be decided by the home page's section configuration, and by nothing else. A store MUST be able to keep its newsletter wording on file while the section is switched off, and switching it back on MUST restore that wording unchanged.

The newsletter's wording — its heading, its supporting text, its input placeholder and its button label — SHALL remain separately editable and part of the public payload, unchanged in shape by this requirement.

In the order a store receives when it has never configured its home page, the newsletter SHALL be **last**, after the recent blog posts, and SHALL be **switched on**.

A store whose home-page configuration was saved before the newsletter became a section MUST receive the newsletter in that configuration, switched on, without any migration of its stored data. It MUST NOT be reported as missing, and it MUST NOT displace or reorder the sections that store had already chosen.

#### Scenario: A store that never configured its home page

- **WHEN** the public settings are read for a store whose home-page configuration has never been saved
- **THEN** the returned section list includes the newsletter, switched on, in last position after the recent blog posts

#### Scenario: A configuration saved before the newsletter existed

- **WHEN** the public settings are read for a store whose stored home-page configuration names every section except the newsletter
- **THEN** the returned list carries that store's own sections in the order it saved them
- **AND** the newsletter appears among them, switched on, at the position the default order gives it

#### Scenario: Merchant switches the newsletter off

- **WHEN** an OWNER/ADMIN saves a home-page configuration with the newsletter switched off
- **THEN** the public read reports the newsletter as switched off, with every other section's order and state unchanged
- **AND** the store's newsletter wording is still readable in the public payload

#### Scenario: Merchant moves the newsletter up the page

- **WHEN** an OWNER/ADMIN saves a home-page configuration placing the newsletter above the recent blog posts
- **THEN** the public read returns the sections in exactly that order

#### Scenario: Wording survives the section being switched off

- **WHEN** the newsletter is switched off and later switched back on
- **THEN** the heading, supporting text, placeholder and button label the merchant had written are unchanged

#### Scenario: An unrecognised section key is still rejected

- **WHEN** an OWNER/ADMIN submits a home-page configuration naming a section that is not in the published set
- **THEN** the request is rejected with a validation error and no settings are changed
