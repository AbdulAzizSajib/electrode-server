## MODIFIED Requirements

### Requirement: Only active, in-window banners are publicly served
The public banner listing SHALL exclude banners that are not `ACTIVE` or are outside their `startsAt`/`endsAt` window, ordered by `sortOrder`. Each served banner SHALL carry the promo banner group it belongs to, or null when it belongs to none, so a client can render a promotional banner in the context of its group without a second request.

#### Scenario: Scheduled banner not yet live
- **WHEN** a `Banner` has `status: ACTIVE` but `startsAt` in the future
- **THEN** it does not appear in the public banner listing yet

#### Scenario: Grouped promotional banner
- **WHEN** an `ACTIVE`, in-window banner with the promotional placement belongs to a promo banner group
- **THEN** it appears in the listing carrying that group's identifier

#### Scenario: Banner with no group
- **WHEN** an `ACTIVE`, in-window banner belongs to no promo banner group
- **THEN** it appears in the listing carrying a null group identifier

## ADDED Requirements

### Requirement: Promotional banners are served per group, not as one strip

The public banner data SHALL allow a client to resolve which banners belong to which promo banner group, so a store with several promotional strips renders each strip's own artwork. A promotional banner belonging to no group SHALL NOT render in any strip.

#### Scenario: Two groups on one homepage

- **WHEN** a store has a group holding three banners and a second group holding one banner
- **THEN** the storefront renders two distinct promotional strips, the first with its three banners and the second with its one

#### Scenario: Ungrouped promotional banner is not rendered

- **WHEN** a store has an `ACTIVE`, in-window promotional banner assigned to no group
- **THEN** it renders in no strip on the storefront, while remaining visible and editable in the admin
