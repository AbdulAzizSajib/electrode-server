## ADDED Requirements

### Requirement: A banner declares which storefront region it belongs to

A banner SHALL carry a placement identifying the storefront region it renders in, and the homepage hero's visually distinct regions SHALL be separately addressable rather than sharing one bucket. The public banner listing SHALL be filterable to exactly one region, so a storefront can populate each differently-shaped region independently without client-side guessing.

#### Scenario: Fetching banners for one hero region

- **WHEN** an unauthenticated request lists banners filtered to a single hero region
- **THEN** only banners assigned to that region are returned, ordered by `sortOrder` ascending
- **AND** banners assigned to any other region are absent

#### Scenario: A banner sized for one region does not appear in another

- **WHEN** a banner is assigned to the wide hero promo region
- **THEN** it does not appear in a listing filtered to the square hero side region, so it cannot be rendered at the wrong aspect ratio

#### Scenario: Listing without a region filter

- **WHEN** an unauthenticated request lists banners with no region filter
- **THEN** every qualifying banner is returned regardless of region, preserving the unfiltered behavior

#### Scenario: An unrecognized region is rejected

- **WHEN** a request creates or updates a banner with a region value the system does not define
- **THEN** the request is rejected with a validation error and no banner is created or changed

#### Scenario: Existing banners keep their region

- **WHEN** hero regions are introduced
- **THEN** banners already assigned to the pre-existing header region retain it and continue to be served to any client requesting that region

### Requirement: The number of banners shown in a region is the storefront's decision

The public listing SHALL return every banner qualifying for a region, without imposing a per-region maximum. An administrator SHALL be able to publish as many banners to a region as they choose, and the API SHALL NOT reject or silently drop banners for exceeding a count.

#### Scenario: More banners than a region's default layout expects

- **WHEN** an administrator publishes five banners to a hero region whose layout was designed around two
- **THEN** all five are returned by the public listing in `sortOrder` order, and none is rejected at creation time

#### Scenario: A region with no banners

- **WHEN** an unauthenticated request lists banners for a region that has no qualifying banners
- **THEN** the response is 200 with an empty list, not an error

## MODIFIED Requirements

### Requirement: Only active, in-window banners are publicly served
The public banner listing SHALL exclude banners that are not `ACTIVE` or are outside their `startsAt`/`endsAt` window, ordered by `sortOrder`. These conditions SHALL apply identically to every storefront region — a region filter narrows which banners are considered, and never relaxes the status or scheduling rules.

#### Scenario: Scheduled banner not yet live
- **WHEN** a `Banner` has `status: ACTIVE` but `startsAt` in the future
- **THEN** it does not appear in the public banner listing yet

#### Scenario: An expired banner is excluded from a region listing
- **WHEN** a banner assigned to a hero region has an `endsAt` in the past
- **THEN** it is absent from that region's public listing even though the region filter matches it
