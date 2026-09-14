## Purpose

Defines how a storefront page stops showing data that has since changed in the admin: which cached reads carry an invalidation tag, who drops that tag and when, and what the storefront does when the invalidation channel is unavailable. Without this contract a merchant's save is invisible until an arbitrary timer elapses, which reads as a broken feature rather than a cache.

## ADDED Requirements

### Requirement: Every merchant-editable storefront resource carries a cache tag

Every storefront read whose response can be changed by a merchant action SHALL declare a cache tag on its cached fetch. A resource read without a tag has no invalidation channel and SHALL NOT be introduced.

The tagged resources are: store settings, SEO config, blog posts, testimonials, landing pages, campaigns, banners, brands, categories, pages, products and reviews.

Where a resource is read through more than one request, **every** such request SHALL carry that resource's tag.

#### Scenario: A tagged resource is read

- **WHEN** the storefront issues a cached read for any of the twelve resources above
- **THEN** the request declares that resource's cache tag
- **AND** the response is retained under that tag until the tag is dropped or the revalidate window elapses

#### Scenario: A resource is read through several endpoints

- **WHEN** a resource is read by more than one request — such as a catalog listing and a single-item detail read
- **THEN** every one of those requests declares the same resource tag
- **AND** dropping the tag invalidates all of them together, leaving none serving data older than the others

#### Scenario: A new cached storefront resource is added later

- **WHEN** a cached storefront read for a new merchant-editable resource is introduced
- **THEN** it declares a cache tag, the tag is permitted by the invalidation endpoint, and the backend fires it on write
- **AND** a read introduced without all three is incomplete

### Requirement: A cache tag covers a whole resource, not a single item

A cache tag SHALL identify a resource class, not an individual record. Changing any record of a resource SHALL invalidate every cached read of that resource.

#### Scenario: One record of a resource changes

- **WHEN** a single product is edited
- **THEN** every cached read of products is invalidated, including listings and the detail reads of products that did not change
- **AND** the next request for any of them re-fetches

#### Scenario: Per-item invalidation is requested

- **WHEN** a narrower invalidation is wanted, such as dropping only the edited product
- **THEN** the resource-level tag remains in place and continues to satisfy this requirement
- **AND** any per-item scheme is additive to it, never a replacement

### Requirement: The backend drops a resource's tag on every write to it

The backend SHALL request invalidation of a resource's tag after every create, update and delete of that resource, including bulk operations, status or visibility toggles, and asset replacement.

Invalidation is requested **after** the write has committed, so a dropped tag never causes a re-fetch of data that is not yet visible.

#### Scenario: A record is created

- **WHEN** a merchant creates a record of a tagged resource
- **THEN** the backend requests that the resource's tag be dropped
- **AND** the next storefront request for that resource reflects the new record

#### Scenario: A record is deleted

- **WHEN** a merchant deletes a record of a tagged resource
- **THEN** the backend requests that the resource's tag be dropped
- **AND** the next storefront request no longer renders the deleted record

#### Scenario: A record is changed without being created or deleted

- **WHEN** a merchant changes a record through a bulk action, a status or visibility toggle, or by replacing an image
- **THEN** the backend requests that the resource's tag be dropped, exactly as for a direct update
- **AND** no mutating path for a tagged resource leaves the storefront cache untouched

### Requirement: Invalidation never fails the merchant's write

Requesting invalidation SHALL NOT affect the outcome of the write that triggered it. A write that has committed SHALL be reported as successful regardless of whether invalidation succeeded, and SHALL NOT be delayed waiting for it.

#### Scenario: The storefront is unreachable when a write commits

- **WHEN** a merchant saves and the storefront cannot be reached, responds with an error, or does not respond before the attempt times out
- **THEN** the save is still reported as successful
- **AND** the failure is recorded for an operator
- **AND** the stale cached response expires on its own revalidate window instead

#### Scenario: A write is saved while the storefront is slow

- **WHEN** invalidation takes longer than the write itself
- **THEN** the merchant's save completes without waiting for it

### Requirement: The invalidation endpoint accepts only known tags from an authenticated caller

The storefront SHALL expose an endpoint that drops one named cache tag, and SHALL accept a request only when it is authenticated with the shared invalidation secret and names a tag on an explicit allow-list. It SHALL NOT disclose which tags exist to an unauthenticated caller.

#### Scenario: An authenticated request names an allowed tag

- **WHEN** the endpoint receives a request carrying the correct secret and naming an allow-listed tag
- **THEN** the tag is dropped and the next request for anything cached under it re-fetches

#### Scenario: A request carries a wrong or missing secret

- **WHEN** the endpoint receives a request whose secret is absent or incorrect
- **THEN** the request is rejected
- **AND** the response reveals nothing about which tags exist or whether the named one was valid

#### Scenario: An authenticated request names an unknown tag

- **WHEN** an authenticated request names a tag that is not on the allow-list
- **THEN** the request is rejected and no tag is dropped

#### Scenario: A tag is fired that the endpoint does not permit

- **WHEN** the backend requests a tag the storefront's allow-list does not contain — a spelling drift between the two sides
- **THEN** the rejection is recorded rather than silently discarded, so the mismatch is discoverable
- **AND** the resource continues to refresh on its revalidate window

### Requirement: An unconfigured deployment degrades visibly, not silently

When the invalidation secret is absent from either side, the system SHALL continue to serve and to accept writes, and SHALL make the unconfigured state observable rather than presenting as working invalidation.

#### Scenario: The secret is missing on the storefront

- **WHEN** the invalidation endpoint is called and the storefront has no secret configured
- **THEN** it reports that invalidation is unconfigured rather than reporting success
- **AND** a caller cannot mistake the response for a completed invalidation

#### Scenario: The secret is missing on the backend

- **WHEN** a write commits and the backend has no secret configured
- **THEN** no invalidation request is sent, the write still succeeds, and the condition is stated for an operator
- **AND** the notice is emitted once rather than on every write

#### Scenario: An operator asks whether invalidation is working

- **WHEN** an operator needs to confirm the two sides are correctly paired
- **THEN** the pairing can be verified without inspecting live traffic or reading logs

### Requirement: The revalidate window is a correctness floor, not the expected latency

Each tagged read SHALL retain its own revalidate window as a bound on staleness when invalidation does not arrive. The expected behaviour after a merchant's save is that the change is visible on the next request; the window is what limits staleness when the invalidation is lost, rejected or unconfigured.

A window SHALL NOT be shortened as a substitute for a missing tag.

#### Scenario: Invalidation arrives normally

- **WHEN** a merchant saves and invalidation succeeds
- **THEN** the next storefront request shows the change, regardless of how much of the revalidate window remains

#### Scenario: Invalidation is lost

- **WHEN** a merchant saves and the invalidation request never reaches the storefront
- **THEN** the change becomes visible no later than the end of that resource's revalidate window
- **AND** the storefront never serves the stale response indefinitely

#### Scenario: A resource refreshes too slowly for a merchant

- **WHEN** a resource's updates are judged to appear too slowly
- **THEN** the resolution is to ensure its tag is declared and fired
- **AND** shortening its window instead is not a substitute, because it leaves a wait and multiplies read load for every visitor

### Requirement: A section whose source record is gone stops rendering

A storefront section driven by a time-bounded record SHALL stop rendering when that record no longer qualifies to be shown, whether because its window has passed or because it was deleted, disabled or rescheduled.

A client-side deadline check SHALL NOT be relied on as the only mechanism, since it cannot observe a record's removal.

#### Scenario: A time-bounded record's window passes while a visitor is on the page

- **WHEN** a visitor is viewing a section whose record reaches the end of its window
- **THEN** the section stops rendering without requiring a reload

#### Scenario: A time-bounded record is deleted before its window ends

- **WHEN** a merchant deletes such a record while it is still within its window
- **THEN** the resource's tag is dropped and the next request omits the section
- **AND** the section does not continue rendering on the strength of a deadline that has not yet passed
