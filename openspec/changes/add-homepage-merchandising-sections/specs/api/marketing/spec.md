## ADDED Requirements

### Requirement: A campaign can be assigned an addressable storefront placement
A campaign SHALL be able to declare which storefront slot it occupies, so a storefront can request the campaign belonging to a named slot without hardcoding a campaign identifier or guessing from among concurrently running campaigns.

A placement SHALL be optional. Most campaigns are ordinary discounts that belong in no particular slot, and such a campaign SHALL behave exactly as it does today — its discounts still apply automatically to its products, and it is simply not addressable by slot.

At most one campaign SHALL be served for a given slot at a given moment. When more than one eligible campaign declares the same placement, the one that started most recently SHALL be served, so that a newly launched campaign supersedes its predecessor without an administrator having to first deactivate the old one.

#### Scenario: Campaign declares a placement
- **WHEN** an ADMIN creates or updates a campaign with a storefront placement
- **THEN** the campaign is addressable by that placement
- **AND** its discounts continue to apply to its products exactly as before

#### Scenario: Campaign without a placement
- **WHEN** a campaign is created with no placement
- **THEN** it occupies no storefront slot
- **AND** its discounts still apply automatically to its tagged products

#### Scenario: Two campaigns claim the same slot
- **WHEN** two campaigns are eligible at the same moment and both declare the same placement
- **THEN** the one with the most recent start is served for that slot
- **AND** the other is not served for that slot, though its discounts still apply to its products

#### Scenario: Placement is rejected if not recognised
- **WHEN** a campaign is created or updated with a placement value that is not defined
- **THEN** the request is rejected with a validation error naming the field and the campaign is not written

### Requirement: The public can read the campaign occupying a storefront slot
An anonymous request SHALL be able to retrieve the campaign currently occupying a named storefront placement, together with the products it discounts and the prices those products carry under it.

The response SHALL include the campaign's end time when one is set, so that a storefront can display an accurate deadline. A campaign with no end time SHALL be served with its end time reported as absent, and SHALL NOT be reported with a fabricated or default deadline.

Eligibility SHALL match the rule campaign discounts already use: the campaign is `ACTIVE` and the present moment falls within its `startsAt`/`endsAt` window. A campaign that is scheduled, paused, completed, cancelled, in draft, or outside its window SHALL NOT be served, even when it declares the placement.

This read SHALL require no session. It SHALL expose only what a storefront renders — the campaign's descriptive fields, its window, and its products with their pricing — and SHALL NOT expose the discount configuration or administrative fields of the campaign record.

#### Scenario: Slot is occupied
- **WHEN** an unauthenticated request asks for the campaign in a placement, and an eligible campaign occupies it
- **THEN** the campaign's name, description, and end time are returned
- **AND** its products are returned with the price each carries under the campaign

#### Scenario: Slot is empty
- **WHEN** an unauthenticated request asks for a placement that no eligible campaign occupies
- **THEN** the response reports the slot as empty rather than erroring
- **AND** the storefront can omit the section

#### Scenario: Campaign is scheduled but not yet started
- **WHEN** a campaign declares a placement and is `ACTIVE`, but its start is in the future
- **THEN** it is not served for that placement yet

#### Scenario: Campaign has expired
- **WHEN** a campaign that occupied a placement passes its end time
- **THEN** it is no longer served for that placement
- **AND** the slot reads as empty until another eligible campaign occupies it

#### Scenario: Campaign has no end time
- **WHEN** an eligible campaign occupying a placement has no end time set
- **THEN** it is served with its end time reported as absent, not as a computed or default deadline

#### Scenario: Unknown placement requested
- **WHEN** an unauthenticated request asks for a placement value that is not defined
- **THEN** the request is rejected with a validation error naming the parameter

#### Scenario: Only paused campaign occupies the slot
- **WHEN** the only campaign declaring a placement has been paused
- **THEN** the slot reads as empty
- **AND** no campaign data is returned
