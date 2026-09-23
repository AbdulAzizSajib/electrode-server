## Purpose

Defines which parts of the storefront header remain visible as the user scrolls, so
category navigation stays within reach without the full header consuming the viewport.

## ADDED Requirements

### Requirement: Only the category nav persists while scrolling

The header comprises three stacked rows — an announcement bar, a main row carrying the
logo and search, and a category navigation row. While the page is scrolled, only the
category navigation row SHALL remain pinned to the top of the viewport. The announcement
bar and the main row SHALL scroll out of view with the rest of the page.

#### Scenario: Page scrolled down from the top

- **WHEN** the user scrolls down past the height of the header
- **THEN** the announcement bar and the main logo/search row are no longer visible
- **AND** the category navigation row is pinned to the top of the viewport

#### Scenario: Page returned to the top

- **WHEN** the user scrolls back to the top of the page
- **THEN** all three header rows are visible in their original stacked order
- **AND** the category navigation row sits directly beneath the main row, not overlapping it

#### Scenario: Page shorter than the viewport

- **WHEN** a page has too little content to scroll
- **THEN** the full header is visible
- **AND** no row is pinned or duplicated

### Requirement: Pinned nav does not conceal content

Content MUST remain fully readable while the category navigation row is pinned.

#### Scenario: Scrolling to an anchored section

- **WHEN** the page scrolls to an element targeted by an in-page link
- **THEN** that element rests fully below the pinned navigation row, with none of it obscured

#### Scenario: Reading content beneath the pinned row

- **WHEN** the user scrolls through page content
- **THEN** no content is permanently hidden behind the pinned navigation row

### Requirement: Pinned nav stacks above page content

The pinned category navigation row MUST render above page content, and its own menus
MUST render above it.

#### Scenario: Content scrolls beneath the pinned row

- **WHEN** page content scrolls past the pinned navigation row
- **THEN** the content passes underneath it and the row stays fully legible

#### Scenario: Opening a category menu while pinned

- **WHEN** the user opens a category menu while the navigation row is pinned
- **THEN** the menu is displayed in full above the page content
- **AND** the menu is not clipped by the boundary of the navigation row

#### Scenario: Overlay opened while nav is pinned

- **WHEN** a full-screen overlay such as the cart drawer is opened
- **THEN** the overlay is displayed above the pinned navigation row

### Requirement: Category nav is desktop-only

The pinned category navigation row SHALL be presented only at desktop widths, where it
is part of the header. At smaller widths the storefront's existing mobile navigation
remains the means of browsing categories.

#### Scenario: Viewing on a small screen

- **WHEN** the user views the storefront at a mobile width
- **THEN** no category navigation row is pinned to the top of the viewport
- **AND** the mobile navigation affordances remain available and unobstructed
