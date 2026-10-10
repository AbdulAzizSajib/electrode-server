## Purpose

How the storefront's header and footer each present the shop's identity — as a text wordmark or as a logo image. The two are decided independently, so a shop whose header sits on its brand colour and whose footer sits on a dark bar can show artwork in one and the wordmark in the other without having to delete either.

## ADDED Requirements

### Requirement: The header and footer brand slots are decided independently

The system SHALL hold two separate brand display modes — one governing the header, one governing the footer — each being either the text wordmark or a logo image. The two SHALL be settable to different values, and changing one SHALL NOT change the other.

The mode alone SHALL decide what a slot renders. Whether a logo image has been uploaded SHALL NOT by itself change what is displayed, so a merchant may keep artwork on file for a slot that is currently showing text.

#### Scenario: A logo header above a text footer

- **WHEN** a merchant sets the header to show a logo and the footer to show the wordmark
- **THEN** the storefront header renders the logo image and the footer renders the wordmark

#### Scenario: A text header above a logo footer

- **WHEN** a merchant sets the header to show the wordmark and the footer to show a logo
- **THEN** the storefront header renders the wordmark and the footer renders the logo image

#### Scenario: Changing only one slot

- **WHEN** a merchant changes the footer's mode
- **THEN** the header continues to display exactly as it did before

#### Scenario: Artwork retained while showing text

- **WHEN** a slot has a logo image uploaded and its mode is set to the wordmark
- **THEN** that slot renders the wordmark
- **AND** the uploaded image is retained, so switching the mode back displays it again without re-uploading

#### Scenario: An unauthorised change

- **WHEN** a signed-in user whose role does not permit store administration tries to change either mode
- **THEN** the change is refused and both modes are left as they were

### Requirement: Each slot resolves to its own artwork, with the footer falling back to the header's

The system SHALL hold two logo images — a header logo and a footer logo — so that a slot may carry artwork cut for the background it sits on.

In logo mode:

- the header SHALL display the header logo;
- the footer SHALL display the footer logo when one is set, and otherwise SHALL display the header logo.

A footer logo that is not set SHALL remain distinguishable from a footer logo set to the same image as the header, so that clearing the footer's artwork restores the fallback rather than pinning a copy.

#### Scenario: Footer with its own artwork

- **WHEN** the footer is in logo mode and a footer logo is set
- **THEN** the footer displays the footer logo, not the header's

#### Scenario: Footer without its own artwork

- **WHEN** the footer is in logo mode, no footer logo is set, and a header logo is set
- **THEN** the footer displays the header logo

#### Scenario: Clearing the footer's artwork

- **WHEN** a merchant removes the footer logo while the footer is in logo mode
- **THEN** the footer displays the header logo
- **AND** the footer is recorded as having no artwork of its own rather than as carrying a copy of the header's

### Requirement: A brand slot never renders empty

The system SHALL render the text wordmark in any slot whose mode names a logo but for which no image can be resolved. A brand slot SHALL NOT render as blank or as a broken image.

This SHALL hold both when no artwork has been uploaded for that slot's fallback chain, and when the shop's settings cannot be read at all.

#### Scenario: Logo mode with no artwork uploaded

- **WHEN** a slot is in logo mode and neither its own logo nor its fallback is set
- **THEN** that slot renders the text wordmark

#### Scenario: Settings unavailable

- **WHEN** the shop's settings cannot be read
- **THEN** both slots render the text wordmark

#### Scenario: The image itself fails to load

- **WHEN** a slot is in logo mode with artwork set, and that image fails to load in the shopper's browser
- **THEN** the shop's name is still conveyed in that slot rather than leaving an unlabelled gap

### Requirement: A logo carries the shop's name as its accessible label and links home

The system SHALL give every rendered logo image a text alternative naming the shop, so that the brand is announced identically whether a slot is in logo or text mode.

A brand slot SHALL be a link to the storefront home page in both modes, so that switching modes does not remove a navigation route a shopper relies on.

#### Scenario: A logo announced to assistive technology

- **WHEN** a slot renders a logo image
- **THEN** the image carries a text alternative naming the shop

#### Scenario: The home link survives a mode change

- **WHEN** a merchant switches a slot from the wordmark to a logo
- **THEN** that slot remains a link to the storefront home page

### Requirement: Logo height is merchant-set, bounded, and reserves its space

The system SHALL let a merchant set the displayed height of the header logo and of the footer logo independently, in pixels. Logo width SHALL follow the image's own proportions, so artwork of any aspect ratio is displayed without distortion and without needing to be re-cut.

Each height SHALL be constrained to a bounded range; a value outside that range SHALL be refused. Where no height has been set, the system SHALL apply a built-in default rather than leaving the size unspecified.

The space a logo occupies SHALL be reserved before the image loads, so that a logo arriving late SHALL NOT shift the content of the page around it.

#### Scenario: Setting different heights per slot

- **WHEN** a merchant sets one height for the header logo and a different height for the footer logo
- **THEN** each logo renders at its own height

#### Scenario: Preserved proportions

- **WHEN** a logo is displayed at its configured height
- **THEN** its width follows the image's own aspect ratio and the image is not stretched or squashed

#### Scenario: A height outside the permitted range

- **WHEN** a height is submitted above or below the permitted range
- **THEN** the change is refused and the stored heights are left as they were

#### Scenario: No layout shift on load

- **WHEN** a page renders with a slot in logo mode and the image has not yet loaded
- **THEN** the slot already occupies its configured height, and the surrounding content does not move once the image arrives

#### Scenario: No height configured

- **WHEN** a slot is in logo mode and no height has been set for it
- **THEN** the logo renders at the built-in default height for that slot

### Requirement: A store that has never configured branding displays as it did before

The system SHALL default both brand modes to the text wordmark. A store that has never chosen a mode — including one whose settings predate the modes existing — SHALL render its header and footer wordmark exactly as it did before brand modes were introduced.

Introducing this capability SHALL NOT change what any existing storefront displays until a merchant chooses to change it.

#### Scenario: An existing store, untouched

- **WHEN** a store whose settings predate brand modes is rendered
- **THEN** both the header and the footer display the text wordmark

#### Scenario: An existing store with logos already uploaded

- **WHEN** a store that had uploaded a header or footer logo before brand modes existed is rendered
- **THEN** both slots still display the text wordmark, because neither mode has been set to show a logo
- **AND** the uploaded artwork remains available to display once a mode is changed

### Requirement: Both modes, both logos and both heights are edited from one screen

The system SHALL let a merchant read and change each slot's mode, artwork and height from a single branding screen, and SHALL show which mode each slot is currently in.

Saving on that screen SHALL change only the branding values and SHALL leave every other store setting untouched.

The screen SHALL describe the behaviour it actually produces — in particular the footer's fallback to the header's artwork, and the fallback to the wordmark when a logo mode has no image.

#### Scenario: Editing branding

- **WHEN** a merchant opens the branding screen
- **THEN** each slot's current mode, current artwork and current height are shown and can be changed

#### Scenario: Saving branding leaves other settings alone

- **WHEN** a merchant saves the branding screen
- **THEN** the branding values are stored
- **AND** currency, checkout, navigation and every other unrelated setting are unchanged

#### Scenario: A branding change reaches the storefront promptly

- **WHEN** a merchant changes a brand mode, a logo or a height
- **THEN** the storefront reflects it without waiting for its cached settings to expire on their own
