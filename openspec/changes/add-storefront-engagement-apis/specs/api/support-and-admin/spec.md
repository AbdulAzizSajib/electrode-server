## ADDED Requirements

### Requirement: A product's rating aggregate always reflects its approved reviews

Every product SHALL carry an average rating and a review count derived solely from its `APPROVED` reviews. The aggregate SHALL be updated whenever any event changes which reviews are approved or what they rate — approval, rejection, hiding, author edit, author deletion, or admin deletion — so that a published aggregate never disagrees with the reviews a shopper can actually read.

#### Scenario: A review is approved

- **WHEN** a moderator approves a pending review
- **THEN** the product's review count increases by one and its average rating is recalculated to include that review's rating

#### Scenario: An approved review is rejected or hidden

- **WHEN** a moderator moves a previously `APPROVED` review to `REJECTED` or `HIDDEN`
- **THEN** the product's review count decreases by one and its average rating is recalculated to exclude that review

#### Scenario: A review is deleted

- **WHEN** an `APPROVED` review is deleted, whether by its author or by an administrator
- **THEN** the product's review count and average rating are recalculated to exclude it

#### Scenario: A pending review does not affect the aggregate

- **WHEN** a customer submits a new review and it awaits moderation
- **THEN** the product's review count and average rating are unchanged

#### Scenario: The last approved review is removed

- **WHEN** a product's only `APPROVED` review is rejected or deleted
- **THEN** the product's review count becomes zero and its average rating becomes zero, not null

### Requirement: A product's public review listing reports its rating distribution

The public listing of a product's reviews SHALL report, alongside the reviews themselves, the aggregate rating and the count of `APPROVED` reviews at each rating value, so a storefront can render a rating summary and histogram from a single request.

#### Scenario: Listing reviews for a rated product

- **WHEN** an unauthenticated request lists a product's reviews
- **THEN** the response includes the average rating, the total number of `APPROVED` reviews, and the number of `APPROVED` reviews holding each rating value

#### Scenario: The distribution covers every rating value

- **WHEN** an unauthenticated request lists reviews for a product where no reviewer has awarded a particular rating value
- **THEN** that rating value is still reported in the distribution, with a count of zero

#### Scenario: The distribution ignores unapproved reviews

- **WHEN** a product has reviews awaiting moderation
- **THEN** those reviews are counted in neither the distribution nor the total

### Requirement: A customer can see and manage their own reviews

An authenticated customer SHALL be able to list every review they have authored regardless of moderation status, and SHALL be able to edit or delete their own reviews. A customer SHALL NOT be able to read another customer's unapproved reviews, nor edit or delete a review they did not author.

#### Scenario: Listing one's own reviews

- **WHEN** an authenticated customer lists their own reviews
- **THEN** the response includes their reviews in every status, including `PENDING` and `REJECTED`, which are hidden from the public listing

#### Scenario: Editing an approved review returns it to moderation

- **WHEN** a customer edits the rating or text of a review that is currently `APPROVED`
- **THEN** the review's content is updated, its status returns to `PENDING`, and it stops contributing to the product's public rating aggregate until it is approved again

#### Scenario: Deleting one's own review

- **WHEN** a customer deletes a review they authored
- **THEN** the review is removed and the product's rating aggregate is recalculated

#### Scenario: Acting on another customer's review

- **WHEN** an authenticated customer attempts to edit or delete a review authored by someone else
- **THEN** the request is rejected with 404 and the review is unchanged

#### Scenario: Managing reviews without a session

- **WHEN** an unauthenticated request tries to list, edit, or delete customer-owned reviews
- **THEN** the request is rejected with 401

### Requirement: Administrators can delete any review

An OWNER/ADMIN SHALL be able to delete any review outright, independently of the moderation statuses, so that content which must not merely be hidden can be removed. The deletion SHALL be audit-logged and SHALL update the affected product's rating aggregate.

#### Scenario: Admin deletes a review

- **WHEN** an OWNER/ADMIN deletes a review
- **THEN** the review is removed, the product's rating aggregate is recalculated, and an audit entry is recorded identifying the acting user and the deleted review

#### Scenario: Non-admin attempts an administrative deletion

- **WHEN** a STAFF or CUSTOMER user attempts to delete a review through the administrative endpoint
- **THEN** the request is rejected with 403 and the review is unchanged

#### Scenario: Deleting a review that does not exist

- **WHEN** an OWNER/ADMIN attempts to delete a review that is already gone
- **THEN** the response is 404 and no audit entry is recorded

## MODIFIED Requirements

### Requirement: Store settings are singleton-safe through the API too

`GET`/`PATCH` on store settings SHALL always operate on the one `StoreSetting` row (fixed id `"singleton"`) — the API SHALL NOT expose any way to create a second row. This SHALL hold for every settings surface, including the unauthenticated storefront read: reading settings without a session SHALL NOT create, duplicate, or mutate the row. Mutations SHALL be audit-logged.

#### Scenario: Admin updates the tax rate

- **WHEN** an OWNER/ADMIN updates `defaultTaxRatePercent`
- **THEN** the single `StoreSetting` row is updated and every subsequent settings read reflects the new value
- **AND** an audit entry is recorded for the change

#### Scenario: Public settings reads never mutate state

- **WHEN** unauthenticated requests read the public store settings repeatedly
- **THEN** exactly one `StoreSetting` row continues to exist and its stored values are unchanged by the reads
