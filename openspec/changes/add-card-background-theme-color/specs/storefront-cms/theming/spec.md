## ADDED Requirements

### Requirement: A merchant sets the background of the browsing cards

The system SHALL let an authorised merchant set an optional card background colour, stored and validated like the other theme colours. When set, product cards, category tiles, brand tiles, testimonial cards and blog cards SHALL all render on that colour, wherever those cards appear on the storefront.

When it has never been set, every card that exists today SHALL render exactly as it does now: product cards and testimonial cards on white, category tiles on their light grey. Brand tiles and blog card surfaces, which do not exist before this change, SHALL render on white with a light border, matching the product card.

#### Scenario: Merchant chooses a card colour

- **WHEN** a merchant sets the card background to a cream colour and saves
- **THEN** product cards, category tiles, brand tiles, testimonial cards and blog cards on the storefront all render on that cream colour

#### Scenario: Card colour never set

- **WHEN** a shop has never set a card background
- **THEN** product cards and testimonial cards render on white and category tiles on light grey, as before this change
- **AND** brand logos and blog posts sit on white cards with a light border

#### Scenario: Merchant returns to the default

- **WHEN** a merchant who had set a card colour chooses to use the default again and saves
- **THEN** the cards render as they do when the colour was never set

#### Scenario: An invalid card colour is submitted

- **WHEN** a save is attempted with a card background that is not a valid hex colour, or that carries extra style declarations
- **THEN** the save is rejected naming the card background, and no part of the theme is changed

### Requirement: Saving the theme without the card colour keeps it

A theme save that does not mention the card background SHALL leave a previously stored card background unchanged, so callers written before the field existed cannot erase it.

#### Scenario: An older caller saves the theme

- **WHEN** a card background is stored and a theme save arrives without the card background key
- **THEN** the save succeeds and the stored card background is unchanged

### Requirement: The admin warns when card text would be hard to read

The colour settings SHALL show the contrast ratio between the card background and the dark text the cards use, and SHALL flag it when it falls below the 4.5:1 guideline for body text, the same way the existing contrast notes do. The merchant SHALL still be able to save.

#### Scenario: Merchant picks a dark card colour

- **WHEN** a merchant picks a card background dark enough that the cards' dark text falls below 4.5:1 against it
- **THEN** the colour settings show the ratio and a warning that card text may be hard to read

#### Scenario: No card colour chosen

- **WHEN** no card background is set
- **THEN** no card contrast warning is shown
