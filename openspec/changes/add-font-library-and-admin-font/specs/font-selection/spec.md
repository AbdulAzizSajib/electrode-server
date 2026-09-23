## Purpose

How the storefront and the admin panel each choose a typeface from the font library and apply it. The two selections are independent, so a merchant can run one font for customers and another for the people working behind the counter.

## ADDED Requirements

### Requirement: The storefront and admin panel have independent font selections

The system SHALL hold two separate font selections — one governing the customer-facing storefront, one governing the admin panel — and SHALL allow them to name different fonts. Changing one SHALL NOT change the other.

#### Scenario: Setting different fonts for each surface

- **WHEN** a merchant selects one font for the storefront and a different font for the admin panel
- **THEN** the storefront renders in the first font and the admin panel in the second

#### Scenario: Changing only the admin panel font

- **WHEN** a merchant changes the admin panel font
- **THEN** the storefront's typeface is unaffected

### Requirement: A font is chosen from the library by selection, not by pasting

The system SHALL present each font selection as a single-choice list of the fonts in the library, showing which is currently selected, with each option previewed in the typeface it names. Choosing a font SHALL require selecting an existing library entry; the selection screens SHALL NOT accept a pasted embed. A selection naming a font that is not in the library SHALL be refused.

#### Scenario: Choosing a font

- **WHEN** a merchant opens the font settings
- **THEN** every library font is offered as a single-choice option, each rendered in its own typeface
- **AND** the fonts currently in use by the storefront and by the admin panel are each shown as selected

#### Scenario: Selecting a font that does not exist

- **WHEN** a selection names a font that is not in the library
- **THEN** the change is refused and both selections are left as they were

#### Scenario: An unauthorised selection change

- **WHEN** a signed-in user whose role does not permit theme administration tries to change either font selection
- **THEN** the change is refused

### Requirement: The selected fonts are published with the rest of the theme

The system SHALL publish both the storefront and the admin panel selections as part of the publicly readable theme, each as a family name together with the stylesheet address needed to load it. A stored selection missing either value SHALL be repaired from the built-in default rather than served incomplete.

Changing a selection SHALL take effect on the storefront without waiting for its cache to expire naturally.

#### Scenario: Reading the published theme

- **WHEN** the theme is read
- **THEN** it carries a storefront font and an admin panel font, each with a family name and a stylesheet address

#### Scenario: A stored theme predating the admin font selection

- **WHEN** the theme was stored before an admin panel font selection existed, and so carries no such value
- **THEN** the published theme still carries an admin panel font, resolved from the built-in default

#### Scenario: A selection change reaches the storefront promptly

- **WHEN** a merchant changes the storefront font
- **THEN** the storefront serves the new typeface without waiting for the cached theme to expire on its own

### Requirement: The admin panel renders in its selected font

The admin panel SHALL render in the font selected for it, applying it consistently across the whole interface so that no part of the panel is left in a different typeface than the rest.

#### Scenario: The admin panel picks up its selected font

- **WHEN** a merchant sets the admin panel font and the panel is loaded
- **THEN** the panel renders in that typeface throughout, with no section left in the previous one

#### Scenario: Changing the admin font while using the panel

- **WHEN** a merchant saves a new admin panel font
- **THEN** the panel adopts it without the merchant having to sign out or clear anything

### Requirement: Every surface stays readable when a font is unavailable

Each surface SHALL declare a fallback typeface stack so that text is legible at all times — before the selected stylesheet has loaded, if it fails to load, and if no font has been configured. No surface SHALL render invisible text while waiting for a webfont.

#### Scenario: The stylesheet fails to load

- **WHEN** the selected font's stylesheet cannot be fetched on either surface
- **THEN** that surface renders fully readable text in its fallback typeface

#### Scenario: Nothing configured yet

- **WHEN** no font has been selected for a surface
- **THEN** that surface renders in the typeface it ships with

#### Scenario: While the webfont is still loading

- **WHEN** a page is painted before the selected font's stylesheet has finished loading
- **THEN** its text is visible in the fallback typeface and is replaced by the selected font once it arrives, rather than being blank until then

### Requirement: The storefront applies its font on the first painted frame

The storefront SHALL have its selected typeface in effect on the first painted frame of a page, with no visible switch from a different font after load. The storefront SHALL request only the stylesheet for the font actually selected.

#### Scenario: First paint

- **WHEN** a visitor loads any storefront page
- **THEN** the page paints with the configured font family in effect
- **AND** no re-render swaps the typeface afterwards

#### Scenario: No unused font is fetched

- **WHEN** a visitor loads a storefront page and the merchant has selected a font other than the one the storefront ships with
- **THEN** only the selected font's stylesheet is requested; the shipped default's stylesheet is not fetched

### Requirement: A malformed stored value never reaches the rendered page

Because the theme is stored in a form the database does not constrain, each surface SHALL re-validate the family name and stylesheet address immediately before use and SHALL fall back rather than render a value it cannot vouch for. A stored value SHALL never be interpolated into a page in a way that could introduce styling or markup beyond the typeface itself.

#### Scenario: A stored value edited outside the application

- **WHEN** a theme is stored whose font family or stylesheet address is malformed or was tampered with outside the normal write path
- **THEN** the affected surface renders in its fallback typeface
- **AND** nothing from the stored value alters the page beyond the typeface
