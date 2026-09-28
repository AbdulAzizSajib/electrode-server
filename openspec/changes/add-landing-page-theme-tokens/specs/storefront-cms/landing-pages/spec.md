<!--
  NOTE — WHY THIS IS "ADDED" AND NOT "MODIFIED".

  The requirement below supersedes "A landing page can be themed independently
  of the shop" from `add-conversion-landing-page-sections`, which is NOT YET
  ARCHIVED — so `openspec/specs/storefront-cms/landing-pages/` does not exist,
  and archive refuses a MODIFIED against a spec that is not there.

  Written as ADDED so this change can archive on its own. Whichever change
  archives SECOND must reconcile the pair: the version here supersedes the
  original, because it is the one that describes a token set rather than a
  single accent.
-->

## Purpose

What a single-product campaign landing page is: the content a merchant authors on it, the offer mechanics it can carry, how it is themed, and how the storefront renders it as a chrome-free document built to convert ad traffic.

## ADDED Requirements

### Requirement: A landing page's colours resolve through one token set
A landing page SHALL carry a set of named colour tokens covering every colour it renders: an accent and its soft and contrasting companions, two content surfaces, two text weights, and a border. Every colour the page draws SHALL resolve through one of them.

No colour the page renders SHALL be fixed in a way the merchant cannot change. Changing one token SHALL change every place that token is used, across every section, without the merchant editing anything else.

Each token SHALL be optional. A page that sets none SHALL render exactly as it did before this capability existed, and a page that sets some SHALL take its remaining colours from those same defaults.

A token SHALL accept only a plain colour value. A value that could carry further style declarations SHALL be refused.

#### Scenario: Merchant changes one token
- **WHEN** a merchant changes the accent token
- **THEN** every call to action, badge, highlight and accent band on that page renders in the new colour
- **AND** no other page on the storefront is affected

#### Scenario: Merchant changes a surface
- **WHEN** a merchant changes the alternate surface token
- **THEN** every section using that surface renders in the new colour, and the sections using the primary surface are unchanged

#### Scenario: Page sets no tokens at all
- **WHEN** a visitor opens a page whose merchant has set no colours
- **THEN** it renders in the same colours it rendered in before tokens existed

#### Scenario: Page sets only some tokens
- **WHEN** a merchant sets an accent but no surfaces
- **THEN** the accent applies and the surfaces fall back to their defaults, with no unstyled or transparent area

#### Scenario: A token is given something that is not a colour
- **WHEN** a merchant saves a token value that is not a plain colour
- **THEN** the save is refused, and nothing that could carry further styling is stored

#### Scenario: The shop's own theme is untouched
- **WHEN** a landing page sets every token it has
- **THEN** the storefront's own pages, header and footer render in the shop's colours, unchanged

### Requirement: Sections render as full-width bands
The page's sections SHALL each span the full width of the viewport and carry their own background, with their content held to a readable measure inside. A section SHALL NOT be constrained by a wrapper shared with the sections above and below it.

Each section SHALL declare which surface token it uses rather than naming a colour of its own, so that the page's alternation is a property of the section and remains under the merchant's single point of control.

Adjacent sections SHALL NOT use the same surface where the distinction between them is what the layout relies on.

#### Scenario: A section's background spans the viewport
- **WHEN** a visitor opens the page on a wide screen
- **THEN** each section's background reaches both edges of the viewport, while its text stays within a readable measure

#### Scenario: Sections alternate
- **WHEN** a visitor scrolls the page
- **THEN** consecutive content sections are visually distinguishable from one another by their surface

#### Scenario: Merchant recolours the bands
- **WHEN** a merchant changes a surface token
- **THEN** every band using it changes together, and no section keeps a colour of its own

#### Scenario: Section order is unchanged
- **WHEN** the page renders with bands
- **THEN** the sections appear in the same order they did before, with the same content in each

#### Scenario: Narrow viewport
- **WHEN** a visitor opens the page on a phone
- **THEN** each band still spans the viewport, the content keeps its side padding, and no horizontal scrolling is introduced
