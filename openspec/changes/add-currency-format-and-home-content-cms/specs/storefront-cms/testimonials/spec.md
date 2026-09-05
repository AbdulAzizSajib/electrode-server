## Purpose

Covers the merchant-authored customer testimonials shown in the storefront's "What Our Clients Say" section — what each entry holds, how a merchant controls which appear and in what order, and how the section behaves when a photo is missing or nothing is published.

## ADDED Requirements

### Requirement: A merchant authors testimonials

The system SHALL let an authorised merchant create, edit and delete testimonials from the admin panel. A testimonial SHALL hold the quote, the author's name, the author's role or description, an optional author photo, and a star rating.

#### Scenario: Merchant adds a testimonial

- **WHEN** a merchant creates a testimonial with a quote, name, role and rating, and publishes it
- **THEN** it appears in the storefront's testimonials section without a redeploy

#### Scenario: Merchant edits a quote

- **WHEN** a merchant changes a published testimonial's quote and saves
- **THEN** the storefront shows the new quote

#### Scenario: Merchant deletes a testimonial

- **WHEN** a merchant deletes a testimonial
- **THEN** it no longer appears on the storefront

### Requirement: The star rating is the stored one

The system SHALL render each testimonial's stars from its own stored rating, a whole number from 1 to 5. A rating outside that range SHALL be rejected on save.

#### Scenario: A four-star testimonial

- **GIVEN** a published testimonial with a rating of 4
- **WHEN** the section renders
- **THEN** that card shows four filled stars, not five

#### Scenario: An out-of-range rating

- **WHEN** a merchant saves a testimonial with a rating of 0, 6, or a fraction
- **THEN** the save is rejected with a message naming the accepted range
- **AND** the stored testimonial is unchanged

### Requirement: A testimonial without a photo still renders as a finished card

The system SHALL render the author's uploaded photo when one is present, and SHALL substitute the author's initials when one is not. A card SHALL NOT render a blank space, a broken image, or a generic placeholder image where the photo would be.

#### Scenario: A testimonial with a photo

- **GIVEN** a published testimonial with an uploaded author photo
- **WHEN** the section renders
- **THEN** the card shows that photo alongside the author's name

#### Scenario: A testimonial with no photo

- **GIVEN** a published testimonial with no author photo
- **WHEN** the section renders
- **THEN** the card shows the author's initials in place of a photo
- **AND** the card occupies the same footprint as one that has a photo

### Requirement: A merchant controls the order testimonials appear in

The system SHALL render testimonials in a merchant-controlled order, so the entry a merchant most wants shown can be placed first.

#### Scenario: Merchant reorders

- **GIVEN** three published testimonials
- **WHEN** the merchant moves the third to the top and saves
- **THEN** the storefront section renders it first

#### Scenario: More testimonials than the section holds

- **GIVEN** ten published testimonials
- **WHEN** the homepage section renders
- **THEN** it shows the first four in the merchant's order
- **AND** the merchant can see in the admin panel which entries are beyond what the section shows

### Requirement: Only published testimonials are visible to shoppers

The system SHALL show a testimonial on the storefront only when its status is published. A draft SHALL be visible in the admin panel and nowhere else.

#### Scenario: A draft testimonial

- **GIVEN** a testimonial saved as a draft
- **WHEN** a shopper views the homepage
- **THEN** it does not appear in the section

### Requirement: Empty content leaves no empty section

The system SHALL omit the testimonials section entirely when no testimonial is published, rather than rendering its heading over an empty grid.

#### Scenario: A shop with no testimonials

- **GIVEN** a shop with no published testimonials
- **WHEN** the homepage renders
- **THEN** no "What Our Clients Say" heading and no card grid appear
- **AND** the surrounding sections are spaced as though the section were not part of the page
