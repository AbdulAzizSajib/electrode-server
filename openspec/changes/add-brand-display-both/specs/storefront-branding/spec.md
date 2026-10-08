## MODIFIED Requirements

### Requirement: The header and footer brand slots are decided independently

The system SHALL hold two separate brand display modes, one for the header and one for the footer. Each mode SHALL be one of:

- the text wordmark;
- a logo image;
- the logo image and the text wordmark together.

The two modes SHALL be settable to different values, and changing one SHALL NOT change the other.

The mode alone SHALL decide what a slot renders. Whether a logo image has been uploaded SHALL NOT by itself change what is displayed, so a merchant may keep artwork on file for a slot that is currently showing text.

#### Scenario: A logo header above a text footer

- **WHEN** a merchant sets the header to show a logo and the footer to show the wordmark
- **THEN** the storefront header renders the logo image and the footer renders the wordmark

#### Scenario: A text header above a logo footer

- **WHEN** a merchant sets the header to show the wordmark and the footer to show a logo
- **THEN** the storefront header renders the wordmark and the footer renders the logo image

#### Scenario: Logo and name in the header, wordmark alone in the footer

- **WHEN** a merchant sets the header to show the logo and the wordmark together, and the footer to show the wordmark
- **THEN** the storefront header renders both the logo image and the wordmark
- **AND** the footer renders the wordmark alone

#### Scenario: Changing only one slot

- **WHEN** a merchant changes the footer's mode
- **THEN** the header continues to display exactly as it did before

#### Scenario: Artwork retained while showing text

- **WHEN** a slot has a logo image uploaded and its mode is set to the wordmark
- **THEN** that slot renders the wordmark
- **AND** the uploaded image is retained, so switching the mode back displays it again without re-uploading

#### Scenario: An unrecognised mode is refused

- **WHEN** a mode other than the three permitted ones is submitted for either slot
- **THEN** the change is refused and both modes are left as they were

#### Scenario: An unauthorised change

- **WHEN** a signed-in user whose role does not permit store administration tries to change either mode
- **THEN** the change is refused and both modes are left as they were

### Requirement: A logo carries the shop's name as its accessible label and links home

The system SHALL announce the shop's name exactly once per brand slot, whatever its mode:

- When a slot shows a logo image alone, that image SHALL carry a text alternative naming the shop.
- When a slot shows the logo and the wordmark together, the visible wordmark SHALL name the shop and the image SHALL be presented as decorative, so assistive technology does not announce the name twice.

A brand slot SHALL be a link to the storefront home page in every mode, so that switching modes does not remove a navigation route a shopper relies on.

#### Scenario: A logo announced to assistive technology

- **WHEN** a slot renders a logo image alone
- **THEN** the image carries a text alternative naming the shop

#### Scenario: Logo and name announced once

- **WHEN** a slot renders the logo and the wordmark together
- **THEN** assistive technology announces the shop's name once, from the wordmark
- **AND** the image is not announced as a separate item

#### Scenario: The home link survives a mode change

- **WHEN** a merchant switches a slot between any two modes
- **THEN** that slot remains a link to the storefront home page

## ADDED Requirements

### Requirement: Logo and wordmark together resolve and degrade like a logo slot

In the mode that shows the logo and the wordmark together, the system SHALL:

- render the slot's resolved logo image and the text wordmark side by side, logo first;
- resolve the image exactly as for a slot showing a logo alone. The header uses the header logo. The footer uses its own logo when one is set, and otherwise the header's.
- render the image at the slot's configured logo height, reserving that space before the image loads;
- render the wordmark in the same style that slot uses when it shows the wordmark alone.

When no image can be resolved for the slot, the system SHALL render the wordmark alone, never an empty or broken image beside it.

On a narrow screen, the logo and wordmark together SHALL NOT push the slot's neighbouring controls out of view.

#### Scenario: Header shows logo and name

- **WHEN** the header is set to show the logo and the wordmark together and a header logo is set
- **THEN** the header renders the header logo followed by the shop's name

#### Scenario: Footer borrows the header's artwork

- **WHEN** the footer is set to show the logo and the wordmark together, no footer logo is set, and a header logo is set
- **THEN** the footer renders the header logo followed by the shop's name

#### Scenario: No artwork to show

- **WHEN** a slot is set to show the logo and the wordmark together and neither its own logo nor its fallback is set
- **THEN** that slot renders the wordmark alone

#### Scenario: The configured height applies

- **WHEN** a slot shows the logo and the wordmark together
- **THEN** the image renders at that slot's configured logo height, with its width following the image's own proportions

#### Scenario: A narrow screen

- **WHEN** the header shows the logo and the wordmark together on a phone-width screen
- **THEN** the header's other controls remain visible and usable
