## Purpose

A campaign page: one landing page bound to one product, authored in the admin,
rendered on the storefront without site chrome, and carrying its own content,
ordering and theme.

## ADDED Requirements

### Requirement: A landing page carries the content a campaign page needs

The system SHALL let a merchant author, per landing page: a hero headline, an optional subheadline and an optional badge label; an ordered media gallery of images and videos; a rich-text description body; a list of highlight bullets; a list of question-and-answer rows; a list of customer quotes; a list of trust badges; and an after-order thank-you heading and message. Every one of these except the headline SHALL be optional, and a section with no content SHALL be omitted from the rendered page rather than rendered empty.

A section SHALL also be omitted when the merchant has switched it off, independently of whether it holds content. Emptying a section and disabling a section are distinct acts: the first removes the content, the second removes the section while retaining it. The merchant SHALL NOT have to empty a section in order to hide it.

The sections SHALL render in the order the merchant has stored for that page, and SHALL render in the system's default order when the page has none.

#### Scenario: Merchant authors the full page

- **WHEN** a merchant fills in every content section and publishes
- **THEN** the rendered landing page shows each section in the authored order

#### Scenario: Merchant leaves sections empty

- **GIVEN** a landing page with a headline, one image and an order form but no FAQ, highlights or quotes
- **WHEN** a visitor opens it
- **THEN** the page renders without empty FAQ, highlight or quote sections and without placeholder text

#### Scenario: Merchant hides a section without emptying it

- **GIVEN** a landing page whose highlights section holds content
- **WHEN** the merchant switches that section off and saves
- **THEN** the page renders without the highlights section
- **AND** the highlight content is retained and reappears when the section is switched back on

#### Scenario: Merchant reorders the media gallery

- **WHEN** a merchant reorders the images and videos in the gallery and saves
- **THEN** the storefront gallery presents them in the new order
- **AND** the first item is the one shown before any interaction

#### Scenario: Merchant adds a video

- **WHEN** a merchant adds a video to the gallery
- **THEN** the storefront plays it in place within the gallery
- **AND** it does not autoplay with sound

### Requirement: Sections render as full-width bands

The page's sections SHALL each span the full width of the viewport and carry their own background, with their content held to a readable measure inside. A section SHALL NOT be constrained by a wrapper shared with the sections above and below it.

Each section SHALL declare which surface token it uses rather than naming a colour of its own, so that the page's alternation is a property of the section and remains under the merchant's single point of control.

Adjacent sections SHALL NOT use the same surface where the distinction between them is what the layout relies on. Because the order of sections is the merchant's to change, which surface a section takes SHALL be derived from its position in the resolved order rather than fixed to the section itself, so that alternation survives any reordering or disabling.

#### Scenario: A section's background spans the viewport
- **WHEN** a visitor opens the page on a wide screen
- **THEN** each section's background reaches both edges of the viewport, while its text stays within a readable measure

#### Scenario: Sections alternate
- **WHEN** a visitor scrolls the page
- **THEN** consecutive content sections are visually distinguishable from one another by their surface

#### Scenario: Sections alternate after a reorder
- **WHEN** a merchant reorders or disables sections
- **THEN** the sections that are rendered still alternate, with no two adjacent sections sharing a surface where the layout relies on the distinction

#### Scenario: Merchant recolours the bands
- **WHEN** a merchant changes a surface token
- **THEN** every band using it changes together, and no section keeps a colour of its own

#### Scenario: Section order follows the merchant
- **WHEN** the page renders with bands
- **THEN** the sections appear in the order stored for that page, or in the default order when the page has none

#### Scenario: Narrow viewport
- **WHEN** a visitor opens the page on a phone
- **THEN** each band still spans the viewport, the content keeps its side padding, and no horizontal scrolling is introduced
