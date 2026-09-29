## Purpose

Which sections a campaign page is built from, in what order, which of them are
switched off, and the merchant-authored custom sections among them. Covers the
stored order, the validation that guards it, how a stored order is resolved
against the sections the code actually has, and what a page renders when it has
no stored order at all.

## ADDED Requirements

### Requirement: A landing page stores its own section order

The system SHALL store, per landing page, an ordered list of section entries.
Each entry SHALL name one section and SHALL record whether that section is
enabled. The stored order IS the render order: the system SHALL NOT sort,
normalise or re-group the list on the way to or from the API.

A merchant SHALL be able to move any section to any position in the list,
including the sections that repeat.

#### Scenario: Merchant reorders sections

- **WHEN** a merchant moves the customer-quotes section above the highlights section and saves
- **THEN** the rendered campaign page shows the quotes before the highlights
- **AND** the order survives a reload of both the admin page and the storefront page

#### Scenario: Order is preserved exactly as stored

- **GIVEN** a stored order that is not alphabetical and not the default
- **WHEN** the page is read back through the API
- **THEN** the entries come back in exactly the stored sequence, with nothing reordered or merged

#### Scenario: Two campaigns order their sections differently

- **GIVEN** two published landing pages
- **WHEN** one is ordered with the FAQ early and the other with the FAQ last
- **THEN** each renders its own order, and neither affects the other

### Requirement: A section can be switched off without losing its content

The system SHALL let a merchant disable any section. A disabled section SHALL be
omitted from the rendered page, and its content SHALL be retained unchanged.
Re-enabling a section SHALL restore exactly the content it had, with no
re-authoring.

Disabling a section SHALL NOT require confirmation, because it destroys nothing.

#### Scenario: Merchant switches a populated section off

- **GIVEN** a landing page whose FAQ section holds six question-and-answer rows
- **WHEN** the merchant switches the FAQ section off and saves
- **THEN** the campaign page renders with no FAQ section and no empty space where it was
- **AND** the six rows are still stored

#### Scenario: Merchant switches the section back on

- **GIVEN** a section that was switched off while holding content
- **WHEN** the merchant switches it back on
- **THEN** the page renders it with exactly the content it held before, in the same order

#### Scenario: A disabled section is not merely empty

- **WHEN** a section is disabled
- **THEN** the system distinguishes it from a section the merchant has left empty, and enabling it does not require the merchant to re-enter anything

### Requirement: A merchant can add custom sections

The system SHALL let a merchant add sections of their own beyond the built-in
vocabulary. A custom section SHALL carry a heading, a body, and a layout choice
from the set the system offers. A landing page SHALL support more than one
custom section, and each SHALL be independently orderable, editable and
switchable like any built-in section.

Each custom section SHALL carry an identifier that is stable across saves, so
that reordering or editing one never rewrites another.

Custom section bodies are merchant-authored rich text and SHALL be sanitised
before they reach a browser, on the same terms as every other merchant-authored
HTML surface in the system.

#### Scenario: Merchant adds a custom section

- **WHEN** a merchant adds a custom section with a heading and body and places it between two built-in sections
- **THEN** the campaign page renders it in that position, styled consistently with the sections around it

#### Scenario: Merchant adds several custom sections

- **GIVEN** a landing page with three custom sections
- **WHEN** the merchant edits the middle one and saves
- **THEN** only that section changes, and the other two keep their content, order and enabled state

#### Scenario: Custom section is switched off

- **WHEN** a merchant disables a custom section
- **THEN** it is omitted from the page and its heading and body are retained

#### Scenario: Custom section body carries unsafe markup

- **WHEN** a custom section body contains script or event-handler markup
- **THEN** the rendered page does not execute it

#### Scenario: Custom section is removed

- **WHEN** a merchant deletes a custom section
- **THEN** it is removed from the order and from the page, and the remaining sections keep their relative order

### Requirement: A stored order is resolved against the sections that exist

The system SHALL resolve a stored order against the set of sections the
system currently offers, and SHALL tolerate a stored order that does not match
that set exactly.

An entry naming a section the system no longer offers SHALL be ignored rather
than rendered or treated as an error. A section the system offers that the
stored order does not mention SHALL be appended in its default position rather
than silently dropped, so that a section added after a page was last saved
becomes available to that page rather than invisible on it.

A malformed or unreadable stored order SHALL cause the page to render in the
default order rather than fail to render.

#### Scenario: Stored order names an unknown section

- **GIVEN** a stored order containing an entry the system does not recognise
- **WHEN** a visitor opens the page
- **THEN** the page renders the sections it does recognise, in their stored order, and ignores the unknown entry

#### Scenario: A new section is introduced after a page was saved

- **GIVEN** a landing page saved before a new built-in section existed
- **WHEN** a visitor opens the page
- **THEN** the new section is available to the page in its default position rather than absent from it

#### Scenario: Stored order is malformed

- **GIVEN** a landing page whose stored order cannot be read as a valid list
- **WHEN** a visitor opens the page
- **THEN** the page renders in the default order rather than showing an error

### Requirement: A page with no stored order renders as it did before

The system SHALL treat the absence of a stored section order as meaning the
default order. A landing page that has never been saved through the section
editor SHALL render exactly the sections, in exactly the order, that it rendered
before this capability existed.

#### Scenario: An existing campaign page is opened

- **GIVEN** a published landing page created before section ordering existed
- **WHEN** a visitor opens it
- **THEN** it renders the same sections in the same order and with the same surfaces as before, with no migration step required of the merchant

#### Scenario: Merchant opens the editor without saving

- **WHEN** a merchant opens the section editor for a page that has no stored order and leaves without saving
- **THEN** the page's rendering is unchanged

### Requirement: The stored order is validated before it is persisted

The system SHALL validate a submitted section order before storing it, and SHALL
reject one that is malformed. Validation SHALL be the only gate on what is
persisted, because the storage layer does not constrain the shape of this value.

The system SHALL reject an order that names an unknown section, that omits a
required field on an entry, that exceeds the configured limit on custom sections,
or whose custom section identifiers are not unique within the page.

#### Scenario: Submitted order names an unknown section

- **WHEN** a request stores an order naming a section the system does not offer
- **THEN** the request is rejected with a validation error naming the offending entry

#### Scenario: Duplicate custom section identifiers

- **WHEN** a request stores two custom sections sharing one identifier
- **THEN** the request is rejected rather than stored

#### Scenario: Too many custom sections

- **WHEN** a request stores more custom sections than the configured limit allows
- **THEN** the request is rejected with a validation error stating the limit

#### Scenario: Valid order is stored

- **WHEN** a request stores a well-formed order
- **THEN** it is persisted as sent, in the sequence sent

### Requirement: Band surfaces follow the resolved order

The system SHALL derive each section's background surface from its position in
the resolved order rather than from a fixed assignment per section. Consecutive
rendered sections SHALL remain visually distinguishable from one another after
any reordering.

#### Scenario: Reordering does not produce three identical surfaces in a row

- **WHEN** a merchant reorders sections such that three sections that previously alternated become adjacent
- **THEN** the rendered page still alternates their surfaces rather than rendering them as one continuous block

#### Scenario: Disabling a section does not break alternation

- **WHEN** a merchant disables a section that sat between two others
- **THEN** the two now-adjacent sections do not render on the same surface

### Requirement: Changing sections updates the storefront

The system SHALL invalidate the storefront's cached copy of a landing page when
its section order, section enabled state, or custom section content changes, so
that a merchant's save is visible without waiting for a cache window to expire.

#### Scenario: Merchant saves a reorder

- **WHEN** a merchant reorders sections and saves
- **THEN** the storefront serves the new order on the next request rather than continuing to serve the previous one until its cache window expires

#### Scenario: Merchant disables a section

- **WHEN** a merchant disables a section and saves
- **THEN** the storefront stops rendering that section on the next request
