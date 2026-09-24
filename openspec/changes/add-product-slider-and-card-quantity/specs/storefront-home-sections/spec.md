## ADDED Requirements

### Requirement: The homepage product rows each offer a grid and a slider

Each of the three homepage sections that render a row of products — best selling, featured products, and new arrivals — SHALL offer exactly two layouts, in this order:

| Key | Layout |
|---|---|
| `GRID` | The product cards in a wrapping grid — the arrangement these sections have always rendered. The default. |
| `SLIDER` | The same product cards in a single horizontal row that the shopper scrolls sideways. |

`GRID` SHALL render each section as it rendered before layouts were selectable, so that a shop which has never chosen a layout sees no change of arrangement.

`SLIDER` SHALL render the same products, in the same order, as `GRID` would. Each card SHALL be the same size in both layouts at every viewport width, so that changing layout rearranges the cards without resizing them. The slider SHALL offer a visible control for moving through the row, and SHALL NOT advance on its own.

Each of the three sections SHALL carry its own layout, so a merchant may show one row as a grid and another as a slider. Choosing a layout for one SHALL NOT change the layout of any other.

Both layouts SHALL be subject to the existing rule that a section renders only when it is both enabled and has content: with no products to show, neither layout SHALL render anything, including the heading.

The section whose products share their row with a countdown SHALL NOT offer a choice of layouts, and SHALL continue to render the single arrangement it has today.

#### Scenario: A shop that has never chosen a layout

- **WHEN** a shop's stored configuration carries no layout for any product row
- **THEN** each row renders as a grid, in the arrangement it had before layouts existed

#### Scenario: The slider is chosen for one row

- **WHEN** a merchant chooses the slider layout for the featured products row and saves
- **THEN** the homepage renders the featured products as one horizontal row
- **AND** the row contains the same products, in the same order, that the grid would have shown
- **AND** a shopper can move through the row using a visible control
- **AND** the row does not move unless the shopper acts on it

#### Scenario: Rows are chosen independently

- **WHEN** a merchant sets the featured products row to a slider and leaves the new arrivals row alone
- **THEN** the featured products render as a slider
- **AND** the new arrivals render as a grid

#### Scenario: Cards keep their size across layouts

- **WHEN** a merchant switches a product row from grid to slider at the same viewport width
- **THEN** each product card is rendered at the same width and height as it was in the grid

#### Scenario: No products to show, in either layout

- **WHEN** a product row is enabled in either layout and the query behind it returns no products
- **THEN** the homepage omits that section entirely, including its heading

#### Scenario: The countdown section offers no choice

- **WHEN** a merchant's configuration attempts to set a layout on the section that pairs products with a countdown
- **THEN** the change is refused, stating that the section has only one layout
- **AND** the stored configuration is left as it was

### Requirement: A product row's layout is stored, validated and resolved like any other section's

A product row's chosen layout SHALL be stored as part of that section's entry in the homepage configuration, alongside its enabled flag and position, and SHALL be published to the storefront on the same public settings payload and the same invalidation path as the rest of the configuration.

On write, a configuration naming a layout that the section does not offer SHALL be refused, and the refusal SHALL name the layouts the section does offer.

On read, each product row SHALL always be reported with a layout: one that is absent, unrecognised, or has since been withdrawn SHALL be reported as `GRID`. Resolution on read SHALL NOT rewrite the stored configuration.

A layout belonging to a different section SHALL NOT be accepted on a product row, even where that value is a layout some other section legitimately offers.

#### Scenario: An unknown layout is refused

- **WHEN** a merchant's configuration sets a product row's layout to a value the section does not offer
- **THEN** the change is refused
- **AND** the refusal names `GRID` and `SLIDER` as the layouts offered
- **AND** the stored configuration is left as it was

#### Scenario: Another section's layout is refused

- **WHEN** a merchant's configuration sets a product row's layout to a value only the hero offers
- **THEN** the change is refused
- **AND** the stored configuration is left as it was

#### Scenario: An absent layout is reported as the default

- **WHEN** a stored configuration entry for a product row carries no layout
- **THEN** the published configuration reports that section's layout as `GRID`
- **AND** the stored configuration is not modified

#### Scenario: A saved layout reaches the storefront

- **WHEN** a merchant saves a change to a product row's layout
- **THEN** a subsequent visit to the homepage renders the new layout without a redeploy

### Requirement: The storefront renders a product row's chosen layout and never nothing

The storefront SHALL render each product row in the layout the published configuration names for it. A layout the storefront cannot render — because none was published, because the value is one this build of the storefront does not know, or because the shop's settings could not be read at all — SHALL be rendered as a grid rather than as nothing.

While a product row's content is loading, the placeholder shown in its place SHALL be shaped like the layout that will replace it, so that the arrival of content does not move the page.

#### Scenario: A layout from a newer server

- **WHEN** the published configuration names a product row layout that this build of the storefront has no rendering for
- **THEN** the storefront renders that row as a grid

#### Scenario: Settings cannot be read

- **WHEN** the shop's settings cannot be read
- **THEN** every product row renders as a grid, subject to having content

#### Scenario: The placeholder matches the layout

- **WHEN** a product row is configured as a slider and its products are still loading
- **THEN** the placeholder shown in its place occupies a single row, not a wrapping grid

### Requirement: The merchant chooses a product row's layout on the Home Sections screen

The administration screen that presents the homepage sections as an ordered list SHALL offer each product row's layout choice on that section's own row, presented the same way the featured categories' choice is presented: each option with a drawing of the arrangement and a name, never an internal key alone.

The screen SHALL:

- show the effective layout on load, so that a shop that has never chosen one shows the grid selected rather than nothing selected;
- offer the choice whether or not the section is currently enabled;
- save the layout with the same save as the section's order and enabled state, and warn before navigating away with it unsaved;
- preserve every section's stored layout when the merchant saves a change to another part of the configuration;
- leave the merchant's selection on screen when a save fails, and state why.

#### Scenario: An unconfigured shop shows the default selected

- **WHEN** a merchant opens the screen for a shop that has never chosen a product row layout
- **THEN** each product row shows the grid layout selected

#### Scenario: Choosing the slider

- **WHEN** a merchant selects the slider layout on the new arrivals row and saves
- **THEN** the stored configuration carries `SLIDER` on that section
- **AND** every other section's order, enabled state and layout are unchanged

#### Scenario: An unrelated save preserves the layout

- **WHEN** a merchant who has previously chosen a slider reorders other sections and saves
- **THEN** the stored configuration still carries `SLIDER` on that product row

#### Scenario: A failed save

- **WHEN** a save is refused after the merchant has changed a product row's layout
- **THEN** the merchant's selection remains on screen
- **AND** the reason for the refusal is shown
