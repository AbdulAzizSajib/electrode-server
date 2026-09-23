## ADDED Requirements

### Requirement: A homepage section may offer a closed set of layouts

The section registry SHALL be able to declare, for any section, a closed ordered list of layouts that section can be rendered in. Position 0 in that list SHALL be the section's default layout. A section for which no list is declared SHALL have exactly one arrangement and SHALL NOT accept a layout value.

A layout's key SHALL NOT change once released, since stored merchant configurations refer to layouts by key. Withdrawing a layout SHALL NOT require a data migration: a stored configuration naming a withdrawn layout SHALL continue to be usable, as described below.

Choosing a layout SHALL NOT create, modify or delete any of the content the section draws on. Every layout a section offers SHALL render the same content; only its arrangement SHALL differ.

#### Scenario: A section that offers no choice

- **WHEN** a merchant's configuration attempts to set a layout on a section for which no layout list is declared
- **THEN** the change is refused, stating that the section has only one layout
- **AND** the stored configuration is left as it was

#### Scenario: The default is the first layout listed

- **WHEN** a section offers a list of layouts and a store has never chosen one for it
- **THEN** the section renders in the first layout of that list

#### Scenario: Content is shared across layouts

- **WHEN** a merchant changes a section's layout
- **THEN** the section renders exactly the same content it rendered before, arranged according to the new layout

### Requirement: Featured categories offers a grid and a slider

The `FEATURED_CATEGORIES` section SHALL offer exactly two layouts, in this order:

| Key | Layout |
|---|---|
| `GRID` | The category tiles in a wrapping grid — the arrangement the section has always rendered. The default. |
| `SLIDER` | The same category tiles in a single horizontal row that the shopper scrolls sideways. |

`GRID` SHALL render the section as it rendered before layouts were selectable, so that a shop which has never chosen a layout sees no change of arrangement. One deliberate exception, made on request during implementation and applied to both layouts alike: every tile SHALL be the same height as every other tile at a given viewport width, whatever the height of its image or the length of its name — its image in a band of fixed height and its name in a block that reserves two lines.

`SLIDER` SHALL render the same categories, in the same order, as `GRID` would. Each tile SHALL be the same size in both layouts at every viewport width, so that changing layout rearranges the tiles without resizing them. The slider SHALL offer a visible control for moving through the row. The slider SHALL NOT advance on its own.

Both layouts SHALL be subject to the existing rule that a section renders only when it is both enabled and has content: with no categories to show, neither layout SHALL render anything, including the heading.

#### Scenario: A shop that has never chosen a layout

- **WHEN** a shop's stored configuration carries no layout for the featured categories section
- **THEN** the section renders as a grid, in the arrangement it had before layouts existed

#### Scenario: The slider is chosen

- **WHEN** a merchant chooses the slider layout and saves
- **THEN** the homepage renders the featured categories as one horizontal row
- **AND** the row contains the same categories, in the same order, that the grid would have shown
- **AND** a shopper can move through the row using a visible control
- **AND** the row does not move unless the shopper acts on it

#### Scenario: Tiles keep their size across layouts

- **WHEN** a merchant switches the featured categories from grid to slider at the same viewport width
- **THEN** each category tile is rendered at the same width and height as it was in the grid

#### Scenario: No categories to show, in either layout

- **WHEN** the featured categories section is enabled in either layout and no active category has an image
- **THEN** the homepage omits the section entirely, including its heading

### Requirement: A section's layout is stored with its configuration entry, validated on write and resolved on read

A section's chosen layout SHALL be stored as part of that section's entry in the homepage configuration, alongside its enabled flag and position, and SHALL be published to the storefront on the same public settings payload and the same invalidation path as the rest of the configuration.

On write, a configuration naming a layout that the section does not offer SHALL be refused, and the refusal SHALL name the layouts the section does offer.

On read, a section that offers a choice SHALL always be reported with a layout: one that is absent, unrecognised, or has since been withdrawn SHALL be reported as the section's default. Resolution on read SHALL NOT rewrite the stored configuration.

#### Scenario: An unknown layout is refused

- **WHEN** a merchant's configuration sets the featured categories layout to a value the section does not offer
- **THEN** the change is refused
- **AND** the refusal names `GRID` and `SLIDER` as the layouts offered
- **AND** the stored configuration is left as it was

#### Scenario: An absent layout is reported as the default

- **WHEN** a stored configuration entry for the featured categories section carries no layout
- **THEN** the published configuration reports that section's layout as `GRID`
- **AND** the stored configuration is not modified

#### Scenario: A withdrawn layout is reported as the default

- **WHEN** a stored configuration names a layout the section no longer offers
- **THEN** the published configuration reports the section's default layout
- **AND** the stored configuration is not modified

#### Scenario: A saved layout reaches the storefront

- **WHEN** a merchant saves a change to the featured categories layout
- **THEN** a subsequent visit to the homepage renders the new layout without a redeploy

### Requirement: The storefront renders the chosen layout and never nothing

The storefront SHALL render each section that offers a choice in the layout the published configuration names for it. A layout the storefront cannot render — because none was published, because the value is one this build of the storefront does not know, or because the shop's settings could not be read at all — SHALL be rendered as that section's default layout rather than as nothing.

While a section's content is loading, the placeholder shown in its place SHALL be shaped like the layout that will replace it, so that the arrival of content does not move the page.

#### Scenario: A layout from a newer server

- **WHEN** the published configuration names a featured categories layout that this build of the storefront has no rendering for
- **THEN** the storefront renders the section as a grid

#### Scenario: Settings cannot be read

- **WHEN** the shop's settings cannot be read
- **THEN** the featured categories section renders as a grid, subject to having content

#### Scenario: The placeholder matches the layout

- **WHEN** the featured categories section is configured as a slider and its categories are still loading
- **THEN** the placeholder shown in its place occupies a single row, not a wrapping grid

### Requirement: The merchant chooses a section's layout on the Home Sections screen

The administration screen that presents the homepage sections as an ordered list SHALL, for each section that offers a choice of layouts other than the hero, offer that choice on the section's own row. Each option SHALL be presented with a drawing of the arrangement and a name; an internal key alone SHALL NOT be the only identification.

The screen SHALL:

- show the effective layout on load, so that a shop that has never chosen one shows the default selected rather than nothing selected;
- offer the choice whether or not the section is currently enabled, so a merchant can arrange a section before switching it on;
- save the layout with the same save as the section's order and enabled state, and warn before navigating away with the layout unsaved, as it does for every other unsaved change on the screen;
- preserve every section's stored layout when the merchant saves a change to another part of the configuration;
- leave the merchant's selection on screen when a save fails, and state why.

The hero's layout SHALL continue to be chosen where it is chosen today; this screen SHALL continue to show it read-only with a link, and SHALL NOT offer it as a second control.

#### Scenario: An unconfigured shop shows the default selected

- **WHEN** a merchant opens the screen for a shop that has never chosen a featured categories layout
- **THEN** the featured categories row shows the grid layout selected

#### Scenario: Choosing the slider

- **WHEN** a merchant selects the slider layout on the featured categories row and saves
- **THEN** the stored configuration carries `SLIDER` on that section
- **AND** every other section's order, enabled state and layout are unchanged

#### Scenario: The choice is available while the section is off

- **WHEN** the featured categories section is disabled
- **THEN** the merchant can still select its layout
- **AND** the selection is saved and takes effect when the section is later enabled

#### Scenario: An unrelated save preserves the layout

- **WHEN** a merchant who has previously chosen the slider reorders other sections and saves
- **THEN** the stored configuration still carries `SLIDER` on the featured categories section

#### Scenario: A failed save

- **WHEN** a save is refused after the merchant has changed the featured categories layout
- **THEN** the merchant's selection remains on screen
- **AND** the reason for the refusal is shown

#### Scenario: The hero is not offered here

- **WHEN** a merchant views the hero's row on this screen
- **THEN** its layout is shown read-only with a link to where it is chosen, and no control to change it is offered
