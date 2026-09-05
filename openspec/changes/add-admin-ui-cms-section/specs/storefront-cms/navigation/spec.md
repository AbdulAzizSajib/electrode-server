## Purpose

Makes the storefront's header and footer chrome — main navigation, announcement bar, footer link columns, social links, newsletter copy and the footer brand/contact block — editable by a merchant from the admin panel instead of hardcoded in the storefront source.

## ADDED Requirements

### Requirement: The storefront header renders stored navigation, not hardcoded content
The storefront's main navigation row SHALL be rendered from the stored `mainNav` setting. A nav item SHALL carry a label and an href, and MAY carry one level of dropdown children. The "Shop By Categories" mega menu continues to come from the live catalog and is not part of `mainNav`.

#### Scenario: Renaming a nav item
- **WHEN** an admin changes a nav item's label from "Blogs" to "Articles" and saves
- **THEN** the storefront header shows "Articles" after the settings cache window elapses, with no redeploy

#### Scenario: Dropdown children render
- **WHEN** a nav item has children configured
- **THEN** the header renders it with a dropdown indicator and reveals its children on interaction

#### Scenario: Nesting is capped at one level
- **WHEN** a payload attempts to nest a third level of navigation
- **THEN** the save is rejected with a validation error rather than silently discarding the extra level

#### Scenario: Empty navigation
- **WHEN** `mainNav` is stored as an empty list
- **THEN** the header renders without nav links and the rest of the header — logo, search, cart, account — still works

### Requirement: The announcement bar is merchant-controlled
The strip above the main header SHALL be rendered from the stored `announcementBar` setting: an enabled flag, promotional text, and up to six icon links. Disabling the bar SHALL hide it without discarding its text or links.

#### Scenario: Toggling the bar off and back on
- **WHEN** an admin disables the announcement bar, saves, then re-enables it
- **THEN** the previously entered text and links are still present and render again

#### Scenario: Editing announcement links
- **WHEN** an admin changes the phone number shown in the announcement bar
- **THEN** the storefront shows the new number, and its click target uses the same number

#### Scenario: Bar disabled
- **WHEN** the announcement bar is disabled
- **THEN** the storefront renders no announcement strip and the header below it does not shift or leave a gap

### Requirement: Footer link columns are stored data with real targets
The footer's link columns SHALL be rendered from the stored `footerColumns` setting, where each column has a title and a list of links that each carry both a label and an href. A footer link SHALL never render without a destination.

#### Scenario: Footer links navigate
- **WHEN** a visitor clicks a footer link
- **THEN** the browser navigates to that link's configured href

#### Scenario: Adding a column
- **WHEN** an admin adds a new footer column with a title and links and saves
- **THEN** the storefront footer renders the new column alongside the existing ones

#### Scenario: Column limit enforced
- **WHEN** an admin attempts to save more than six footer columns
- **THEN** the save is rejected with a validation error naming the limit

#### Scenario: Linking a CMS page
- **WHEN** an admin points a footer link at a published page such as Refund Policy
- **THEN** the footer link navigates to that page's storefront URL

### Requirement: Footer brand, contact, social and newsletter blocks are merchant-controlled
The footer's brand column (store name and about text), its contact block (address, email, phone), its social icon row and its newsletter heading and copy SHALL all be rendered from stored settings. Social links SHALL be limited to the platforms the storefront has icons for.

#### Scenario: Editing the about text
- **WHEN** an admin changes the footer about text
- **THEN** the storefront footer's brand column shows the new text

#### Scenario: Contact details update everywhere they appear
- **WHEN** an admin updates the store's contact email
- **THEN** both the footer contact block and any announcement-bar email link reflect it

#### Scenario: Unsupported social platform rejected
- **WHEN** an admin submits a social link for a platform outside the supported set
- **THEN** the save is rejected with a validation error listing the supported platforms

#### Scenario: Omitted social links
- **WHEN** no social links are configured
- **THEN** the footer renders without the social icon row rather than showing empty icons

### Requirement: Navigation and footer edits never clobber unrelated settings
The settings write path is a partial update. Saving from the header editor SHALL leave footer settings untouched, and saving from the footer editor SHALL leave header settings untouched, even though both write to the same underlying settings record.

#### Scenario: Header save preserves footer
- **WHEN** an admin edits and saves main navigation
- **THEN** the stored footer columns, social links and newsletter copy are unchanged

#### Scenario: Footer save preserves header
- **WHEN** an admin edits and saves footer columns
- **THEN** the stored main navigation and announcement bar are unchanged

#### Scenario: Concurrent editors
- **WHEN** two admins save the header editor and the footer editor at roughly the same time
- **THEN** both sets of changes are present afterwards

### Requirement: Chrome degrades safely when settings are unavailable
The header and footer render on every storefront page, so a failed or empty settings read SHALL NOT break the page. On failure the storefront SHALL fall back to the server-provided defaults and render usable chrome.

#### Scenario: Settings endpoint unreachable
- **WHEN** the storefront cannot reach the settings endpoint while rendering a page
- **THEN** the page still renders with default header and footer content and no error is surfaced to the visitor

#### Scenario: Cleared setting falls back
- **WHEN** a navigation or footer setting has never been written
- **THEN** the storefront renders the default content for that block rather than an empty region

### Requirement: Admins edit header and footer chrome from separate, previewable surfaces
The admin panel SHALL provide one editing surface for header chrome (main navigation and announcement bar) and a separate one for footer chrome (columns, social links, newsletter, brand and contact). Both SHALL support adding, editing, removing and reordering entries, and SHALL show a live preview of what the storefront will render before the admin saves.

#### Scenario: Reordering nav items
- **WHEN** an admin reorders main navigation entries and saves
- **THEN** the storefront header renders them in that order

#### Scenario: Preview before save
- **WHEN** an admin edits a nav label but has not yet saved
- **THEN** the editor's preview shows the pending label and indicates the change is unsaved

#### Scenario: Unsaved changes are protected
- **WHEN** an admin navigates away with unsaved header or footer edits
- **THEN** they are warned before the edits are discarded

#### Scenario: Validation errors are actionable
- **WHEN** a save fails validation, such as a nav item missing an href
- **THEN** the error is shown against the specific entry that caused it, not as a single generic message
