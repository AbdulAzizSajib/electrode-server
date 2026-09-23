## Purpose

Gives the storefront header's main row a merchant-configurable slot, so an action like "Track Order" can sit beside Cart and Account where shoppers look for it — rather than in the announcement bar, which is for contact details and a promotional message and vanishes when that bar is switched off.

## ADDED Requirements

### Requirement: The header's main row holds a merchant-configurable list of link actions

The system SHALL store an ordered list of header middle-bar links. Each entry SHALL carry a label and a target, and MAY carry an icon name.

The order of the list SHALL be the order the storefront renders them in.

The list SHALL be independent of the announcement bar's links and of the main navigation. Editing one SHALL NOT change either of the others.

The list SHALL accept at most 4 entries. A label SHALL be at most 100 characters, a target at most 500, and an icon name at most 100 — matching the bounds the announcement bar's links already use.

An entry SHALL require both a non-empty label and a non-empty target. An entry SHALL NOT bind to the store's contact details the way an announcement-bar link may; these are ordinary links.

#### Scenario: A merchant adds a link

- **WHEN** a merchant adds an entry with the label "Track Order" and the target `/track-order` and saves
- **THEN** the storefront header's main row renders it as a link to `/track-order`

#### Scenario: Order is preserved

- **WHEN** a merchant reorders the list and saves
- **THEN** the storefront renders the entries in the new order

#### Scenario: The list is capped

- **WHEN** a merchant already has 4 entries
- **THEN** the admin offers no way to add a fifth
- **AND** a request carrying 5 entries is rejected

#### Scenario: An incomplete entry is rejected

- **WHEN** a save is attempted with an entry whose label or target is empty
- **THEN** the save is rejected and the merchant is told which field is missing

#### Scenario: The three header lists stay independent

- **WHEN** a merchant edits the middle-bar links and saves
- **THEN** the announcement bar's links and the main navigation are unchanged

### Requirement: The links render in the main row beside the header's own actions

The storefront SHALL render the middle-bar links in the header's main row — the row carrying the brand, the search box and the cart — positioned before the cart action.

They SHALL be presented consistently with the header's existing actions in that row, so that a configured link and a built-in action do not read as two different kinds of control.

They SHALL render on the same breakpoints as that row's action group, which is desktop-only. Small-screen surfaces SHALL be unaffected: the mobile bottom navigation and the mobile menu drawer SHALL NOT render these links.

An entry with an icon SHALL render it; an entry without one SHALL render its label alone rather than a placeholder glyph.

An empty list SHALL render nothing at all, leaving the row exactly as it is today, with no gap or separator held open for it.

#### Scenario: A configured link renders beside the cart

- **WHEN** the list holds one entry
- **THEN** it renders in the main row, before the cart action

#### Scenario: An empty list changes nothing

- **WHEN** the list is empty
- **THEN** the main row renders exactly as it does today

#### Scenario: Small screens are unaffected

- **WHEN** a shopper opens the storefront on a narrow viewport
- **THEN** no middle-bar link is rendered, in the header or in the mobile drawer or bottom navigation

#### Scenario: An entry without an icon

- **WHEN** an entry has a label and target but no icon name
- **THEN** it renders its label with no icon and no reserved icon space

### Requirement: The links are independent of the announcement bar's visibility

The middle-bar links SHALL render whether or not the announcement bar is switched on, and SHALL NOT be affected by the announcement bar's text or links.

#### Scenario: The announcement bar is off

- **WHEN** a merchant switches the announcement bar off
- **THEN** the middle-bar links still render in the main row

### Requirement: An existing Track Order announcement link moves into the new list

The system SHALL perform a one-time migration that, for each shop, moves an announcement-bar link whose target is `/track-order` out of `announcementBar.links` and into the middle-bar links, preserving its label and icon and appending it to any entries already there.

The migration SHALL leave every other announcement-bar link in place, including the contact-bound ones.

A shop with no such announcement link SHALL be left unchanged, and SHALL NOT have an entry invented for it.

The migration SHALL run once and SHALL NOT reintroduce the entry if a merchant later removes it.

#### Scenario: A shop with Track Order in its announcement bar

- **WHEN** a shop's announcement bar holds a phone link, an email link and a `/track-order` link
- **THEN** after migration its announcement bar holds the phone and email links only
- **AND** its middle-bar links hold the Track Order entry, with the label and icon it had

#### Scenario: A shop without one

- **WHEN** a shop's announcement bar holds only a phone link and an email link
- **THEN** after migration both are unchanged and its middle-bar links are empty

#### Scenario: The link appears in exactly one place

- **WHEN** migration has run
- **THEN** no shop renders Track Order in both the announcement bar and the main row

#### Scenario: A removal is not undone

- **WHEN** a merchant deletes the migrated entry and saves
- **THEN** it stays deleted

### Requirement: A shop that has configured nothing still shows Track Order

The storefront's fallback settings — served when the settings read fails — SHALL include the Track Order entry in the middle-bar links and SHALL NOT include it in the announcement bar's links.

#### Scenario: A degraded settings read

- **WHEN** the settings read fails and the storefront falls back
- **THEN** the header renders Track Order in the main row
- **AND** does not also render it in the announcement bar

### Requirement: The list is edited on the header editor without disturbing its other fields

The admin SHALL offer editing of this list on the same screen that edits the header's announcement bar and main navigation.

Saving that screen SHALL write the middle-bar links, the announcement bar and the main navigation, and SHALL NOT write any other setting — so that the header editor and every other settings editor continue to save independently without overwriting one another.

The editor SHALL enforce the same bounds the server does, so that a preventable rejection does not require a round trip.

#### Scenario: Saving the header editor leaves other settings alone

- **WHEN** a merchant saves the header editor
- **THEN** only the middle-bar links, the announcement bar and the main navigation are written
- **AND** settings owned by other editors are untouched

#### Scenario: The editor catches an over-long label

- **WHEN** a merchant types a label longer than the limit
- **THEN** the editor prevents or flags it before the save is attempted
