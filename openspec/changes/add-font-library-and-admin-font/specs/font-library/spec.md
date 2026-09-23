## Purpose

A merchant-managed catalogue of Google Fonts that the storefront and admin panel both select from. A font is pasted once — as the embed Google hands out — and stays available to re-select forever, instead of being re-pasted for every change.

## ADDED Requirements

### Requirement: A merchant adds a font by pasting a Google Fonts embed

The system SHALL accept a font as the text Google Fonts hands out — an `@import url(...)` rule, a `<link ...>` tag, or the bare stylesheet URL — and SHALL derive the font's family name and stylesheet address from it. The pasted text SHALL NOT be stored verbatim, and the stored stylesheet address SHALL be one built from validated components rather than a string echoed from the input.

A font whose stylesheet address is not served by `fonts.googleapis.com` over HTTPS SHALL be refused. Host matching SHALL be exact: an address whose host merely ends with `fonts.googleapis.com` SHALL be refused.

#### Scenario: Adding a font from an @import rule

- **WHEN** a merchant adds a font by pasting `@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap");`
- **THEN** a font named `Poppins` is added to the library
- **AND** its stored stylesheet address requests the `Poppins` family with `display=swap`

#### Scenario: Adding a font from a link tag or a bare URL

- **WHEN** a merchant pastes a `<link rel="stylesheet" href="...">` tag, or just the URL on its own
- **THEN** the font is added exactly as it would have been from the equivalent `@import` rule

#### Scenario: A multi-word family is stored readably

- **WHEN** a merchant adds a font whose embed names the family `Open+Sans`
- **THEN** the library lists it as `Open Sans`, with the space

#### Scenario: A non-Google address is refused

- **WHEN** a merchant pastes an embed pointing at a host other than `fonts.googleapis.com` — including a lookalike host that ends with it, such as `fonts.googleapis.com.example.test`
- **THEN** the font is not added
- **AND** the merchant is told only Google Fonts addresses are accepted

#### Scenario: Unintelligible text is refused

- **WHEN** a merchant pastes text containing no usable stylesheet address, or leaves the box empty
- **THEN** the font is not added
- **AND** the merchant is told to paste the embed code from Google Fonts

### Requirement: The library rejects a duplicate font

The system SHALL refuse to add a font whose family name already exists in the library, so the pickers never present the same typeface twice. Comparison SHALL ignore case and surrounding whitespace.

#### Scenario: Re-adding a font already in the library

- **WHEN** a merchant adds an embed for a family the library already contains, in any letter case
- **THEN** the font is not added a second time
- **AND** the merchant is told that font is already in the library

### Requirement: The library is browsable, editable and deletable

The system SHALL let an authorised administrator list the library with search and paging, add a font, replace an existing entry's embed, and delete a font. Each listed font SHALL carry its family name and enough information to render a preview of the typeface itself.

#### Scenario: Listing the library

- **WHEN** an authorised administrator opens the font library
- **THEN** every font in the library is listed, each previewable in its own typeface

#### Scenario: Replacing a font's embed

- **WHEN** an administrator edits a font and pastes a different embed for the same family — for example one carrying different weights
- **THEN** the stored stylesheet address is replaced with the newly parsed one
- **AND** any surface currently using that font picks up the new address without needing to be re-selected

#### Scenario: Deleting an unused font

- **WHEN** an administrator deletes a font that is neither the storefront nor the admin panel selection
- **THEN** the font is removed from the library and disappears from both pickers

### Requirement: Only authorised administrators may change the library

The system SHALL restrict adding, editing and deleting fonts to signed-in administrators with sufficient privilege. Reading the library SHALL be available to any signed-in administrator who can reach the settings screens.

#### Scenario: A staff member without privilege attempts a change

- **WHEN** a signed-in user whose role does not permit theme administration tries to add, edit or delete a font
- **THEN** the request is refused and the library is unchanged

#### Scenario: An unauthenticated request

- **WHEN** an unauthenticated caller tries to add, edit or delete a font
- **THEN** the request is refused

### Requirement: A font in use cannot be deleted without reassignment

The system SHALL refuse to delete a font that is the current storefront selection or the current admin panel selection, and the refusal SHALL name which surfaces hold it. Deletion SHALL succeed once the affected surfaces have been pointed at a different font. Neither surface SHALL ever be left pointing at a font that no longer exists.

#### Scenario: Deleting the storefront's font

- **WHEN** an administrator deletes the font the storefront is using
- **THEN** the deletion is refused and the font remains in the library
- **AND** the message says the font is in use by the storefront
- **AND** the administrator is offered the choice of a replacement font

#### Scenario: Deleting a font both surfaces use

- **WHEN** an administrator deletes a font that is both the storefront and the admin panel selection
- **THEN** the refusal names both surfaces

#### Scenario: Reassigning, then deleting

- **WHEN** an administrator picks a replacement font for every surface using the font, and confirms
- **THEN** those surfaces switch to the replacement
- **AND** the original font is deleted
- **AND** if any part of that fails, neither the selections nor the library are left partly changed

### Requirement: The library ships pre-populated

The system SHALL populate an empty library with a starter set of widely used Google Fonts, including at least one font supporting Bangla script, so a merchant can choose a typeface without visiting fonts.google.com. Starter fonts SHALL be ordinary library entries — editable and deletable, with no protected status.

Populating SHALL be idempotent: repeating it SHALL NOT duplicate fonts or overwrite a merchant's edits.

#### Scenario: First run

- **WHEN** the font library is populated for the first time
- **THEN** the library contains the starter fonts
- **AND** at least one of them supports Bangla script

#### Scenario: Populating again after a merchant has edited the library

- **WHEN** the library is populated again after a merchant has deleted some starter fonts, edited others, and added their own
- **THEN** no font is duplicated
- **AND** no merchant edit is overwritten
- **AND** a starter font the merchant deleted is not silently reinstated

#### Scenario: A deployment where boot-time population does not run

- **WHEN** the application runs in an environment where boot-time population is not performed
- **THEN** an administrator can still populate the library by an explicit, documented action
