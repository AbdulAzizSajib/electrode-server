## ADDED Requirements

### Requirement: A home page section may offer a closed set of layouts

A home page section SHALL be able to offer a closed, ordered set of **layouts** — alternative arrangements of the same section's content — from which an OWNER/ADMIN picks one. The set SHALL be published by the system, not composed by the merchant: a store MUST NOT be able to name a layout the storefront has no rendering for.

Exactly one layout in each set SHALL be that section's **default**, and it SHALL be the arrangement the storefront rendered before layouts became selectable. Introducing this capability therefore MUST NOT change what any existing store's visitors see.

Offering a set SHALL be per section. A section that offers no layouts has exactly one arrangement, and a request that sets a layout on such a section MUST be rejected rather than stored and ignored — storing it would leave a merchant looking at a saved value that governs nothing.

The section list SHALL remain otherwise unchanged: which sections exist, whether each is switched on, and the order they render in are all governed exactly as before, and a layout choice MUST NOT affect any of them.

#### Scenario: The offered layouts are published

- **WHEN** the public store settings are read
- **THEN** each home page section that offers a choice of layout reports which one the store has selected

#### Scenario: Admin selects an offered layout

- **WHEN** an OWNER/ADMIN saves a home page section list in which a section carries one of the layouts that section offers
- **THEN** the choice is persisted
- **AND** both the public and the admin settings reads report it

#### Scenario: An unoffered layout is rejected

- **WHEN** an OWNER/ADMIN saves a home page section carrying a layout that section does not offer
- **THEN** the request is rejected with a validation error and no settings are changed

#### Scenario: A layout on a section that offers none is rejected

- **WHEN** an OWNER/ADMIN saves a home page section that offers no choice of layout, carrying a layout
- **THEN** the request is rejected with a validation error and no settings are changed

#### Scenario: Choosing a layout leaves the rest of the section list alone

- **WHEN** an OWNER/ADMIN changes only a section's layout
- **THEN** every section's on/off state and the order of the whole list are unchanged

### Requirement: A section's layout is resolved on read, never left to the client

Every read of the home page section list SHALL report a **resolved** layout for each section that offers a choice, so that no client has to supply a default of its own. A client that had to default the value would be a second, divergent copy of the rule, and the storefront and the admin panel could disagree about what a store looks like.

A stored layout that is still offered SHALL be reported as stored. A layout that is **absent**, **unrecognised**, or **no longer offered** SHALL resolve to the section's default. Resolution SHALL NOT rewrite what is stored: a store whose record predates this capability MUST keep reading as the default without a migration or a backfill of any kind.

A section list that has never been configured SHALL report each section's default layout, which reproduces the storefront exactly as it behaved before layouts existed.

#### Scenario: A store that has never chosen a layout

- **WHEN** the home page section list is read for a store whose stored configuration carries no layout
- **THEN** each section that offers a choice reports its default layout

#### Scenario: A stored layout survives a round trip

- **WHEN** an OWNER/ADMIN saves a section carrying an offered layout and the settings are read back
- **THEN** the layout reported is the one that was saved, not the default

#### Scenario: A withdrawn layout falls back to the default

- **WHEN** the section list is read for a store whose stored configuration carries a layout the section no longer offers
- **THEN** that section reports its default layout
- **AND** the stored record is not rewritten

#### Scenario: A layout is not lost on the way out

- **WHEN** a stored configuration carrying a layout is read
- **THEN** the layout is present in the response rather than dropped by the reconciliation that fills in missing sections

### Requirement: The homepage hero offers four layouts

The homepage hero SHALL offer four arrangements of the merchant's hero artwork, and the artwork itself SHALL be shared across all four — each arrangement uses some or all of the same three hero image slots, and a merchant MUST NOT have to re-upload anything to try a different one.

The default SHALL be the arrangement carrying a rotating panel beside two square tiles and one wide tile, which is what the storefront rendered before this capability existed.

Switching layout SHALL NOT delete, detach or alter any uploaded hero image. Artwork belonging to a slot the newly chosen layout does not render SHALL remain on file and SHALL be rendered again unchanged if the merchant returns to a layout that uses it. A merchant trying out arrangements MUST NOT be able to destroy their own artwork by doing so.

#### Scenario: Default layout for a store that has never chosen one

- **WHEN** the settings are read for a store that has never chosen a hero layout
- **THEN** the hero reports the arrangement with a rotating panel, two square tiles and one wide tile

#### Scenario: Switching to a layout that uses fewer slots keeps the artwork

- **WHEN** an OWNER/ADMIN switches the hero to a layout that renders no tiles
- **THEN** the tile artwork already uploaded is still recorded and still readable through the banner endpoints

#### Scenario: Switching back restores the artwork unchanged

- **WHEN** an OWNER/ADMIN switches the hero away from a layout and later back to it
- **THEN** every image that layout renders is the one that was uploaded before the switch
