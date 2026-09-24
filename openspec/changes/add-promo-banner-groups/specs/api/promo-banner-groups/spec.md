## Purpose

Lets a merchant create any number of named promotional banner strips for their homepage, each choosing how many tiles it shows across (one, two or three) and owning its own set of banner artwork, instead of the single fixed three-tile strip the storefront used to hardcode.

## ADDED Requirements

### Requirement: A store may hold any number of promo banner groups

The system SHALL let an admin create promo banner groups without a fixed upper bound, each with a merchant-supplied name, a tile layout of `ONE`, `TWO` or `THREE`, and a sort order. A store with no groups SHALL be a valid state that renders no promo strip rather than an error.

#### Scenario: Creating a second group

- **WHEN** an admin creates a group named "Week deals" while a group named "Promo banners" already exists
- **THEN** both groups exist independently, each with its own layout, banners and sort order

#### Scenario: A store with no groups

- **WHEN** every promo banner group has been deleted
- **THEN** the public settings payload carries no promo strip entries and the storefront homepage renders no promo section, with no error

#### Scenario: Name is required and bounded

- **WHEN** an admin submits a group with an empty name, or a name longer than the permitted length
- **THEN** the request is rejected with a validation error and no group is created

### Requirement: A group's layout declares how many tiles it renders across

The system SHALL store a group's layout as one of `ONE`, `TWO` or `THREE`, defaulting to `THREE`. The layout SHALL be served with the group so the storefront renders the declared arrangement without inferring it from the banner count.

#### Scenario: Layout served with the group

- **WHEN** a client reads a group whose layout is `TWO`
- **THEN** the response carries `layout: "TWO"` and the storefront renders that group's banners two across

#### Scenario: Unrecognised layout resolves to the default

- **WHEN** a stored group carries a layout value this release does not recognise
- **THEN** it is served as `THREE` rather than omitted or served as-is, so the strip still renders

#### Scenario: Layout is independent of banner count

- **WHEN** a group's layout is `THREE` but only two banners are assigned to it
- **THEN** the group is served and rendered with the two banners it has, and the request that produced that state is not rejected

### Requirement: A banner belongs to at most one promo group

The system SHALL let an admin assign a banner to a promo banner group, and SHALL reject an assignment when the banner's placement is not the promotional placement. A banner not assigned to any group SHALL remain valid and SHALL NOT render in any promo strip.

#### Scenario: Assigning a promo banner to a group

- **WHEN** an admin assigns a banner with the promotional placement to an existing group
- **THEN** the banner is served as part of that group's banners, ordered by its `sortOrder`

#### Scenario: Assigning a non-promotional banner

- **WHEN** an admin assigns a banner whose placement is a hero, header, footer, sidebar or popup placement to a promo group
- **THEN** the request is rejected with a validation error and no assignment is made

#### Scenario: Reassigning a banner

- **WHEN** an admin moves a banner from one group to another
- **THEN** it renders only in the destination group, and the source group renders its remaining banners

#### Scenario: An ungrouped promotional banner

- **WHEN** a banner carries the promotional placement but no group
- **THEN** it appears in the admin's banner list as unassigned and renders in no promo strip on the storefront

### Requirement: Deleting a group does not delete its banners

The system SHALL detach a group's banners rather than deleting them when the group is deleted, leaving each banner on file with no group. Deleting a group SHALL also remove the homepage section entry that named it.

#### Scenario: Deleting a populated group

- **WHEN** an admin deletes a group holding three banners
- **THEN** the group is gone, the three banners still exist as unassigned promotional banners, and the homepage no longer renders that strip

#### Scenario: Reassigning detached banners

- **WHEN** an admin assigns a previously detached banner to another group
- **THEN** it renders in that group with no other action required

### Requirement: Group mutations are admin-only and audited

The system SHALL restrict creating, updating, reordering and deleting promo banner groups to admin roles, and SHALL record an audit entry for each such mutation. The public read SHALL require no authentication.

#### Scenario: Unauthenticated mutation

- **WHEN** a request without admin credentials attempts to create, update, reorder or delete a group
- **THEN** it is rejected and no change is made

#### Scenario: Public read

- **WHEN** an unauthenticated storefront request reads the public settings payload
- **THEN** it receives the enabled groups with their names, layouts and order

### Requirement: Group writes invalidate the storefront's cached homepage

The system SHALL invalidate the storefront's cached banner and store-settings reads after any group create, update, reorder, delete or banner-assignment write, so a merchant's change to a promo strip becomes visible without waiting out a revalidation window.

#### Scenario: Merchant changes a group's layout

- **WHEN** an admin changes a group's layout from `THREE` to `ONE`
- **THEN** the storefront's cached homepage reads are invalidated and the next request renders the one-tile arrangement

#### Scenario: Merchant renames a group

- **WHEN** an admin renames a group
- **THEN** the cached store-settings read is invalidated, because the group's name and existence are part of the homepage configuration
