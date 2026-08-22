## Purpose

Gives the team a single, visual, browsable page that shows every model and relationship in the Prisma data model, grouped by domain, so the full system can be understood without reading 36 separate `.prisma` files.

## ADDED Requirements

### Requirement: Full-schema overview diagram
The documentation page SHALL include one diagram showing every model defined under `prisma/schema/*.prisma` and every relationship between them (including cardinality: one-to-one, one-to-many, many-to-many).

#### Scenario: All models represented
- **WHEN** a reader opens the ER diagram page
- **THEN** every model present in `prisma/schema/*.prisma` at the time the page was generated appears in the overview diagram
- **AND** no model is silently omitted

#### Scenario: Relationship cardinality is visible
- **WHEN** a reader inspects any connection between two entities in the diagram
- **THEN** the diagram indicates whether the relationship is one-to-one, one-to-many, or many-to-many, matching the corresponding `@relation` in the schema

### Requirement: Domain-grouped sub-diagrams
The documentation page SHALL also present the schema broken into domain-scoped sub-diagrams (at minimum: Auth & RBAC, Catalog, Inventory & Procurement, Orders & Fulfillment, Payments/Refunds/Returns, Marketing, Support, Audit & Notifications), each independently readable without needing the full overview diagram.

#### Scenario: Reader focuses on one domain
- **WHEN** a reader selects a domain section (e.g. "Orders & Fulfillment")
- **THEN** the page shows only the models and relationships relevant to that domain, legibly, without requiring the reader to parse the full 39-model overview

#### Scenario: Every model belongs to exactly one primary domain group
- **WHEN** the domain sub-diagrams are considered together
- **THEN** every model from the overview diagram appears in at least one domain group
- **AND** the grouping is documented so a reader can find any model's home domain

### Requirement: Self-contained, versioned documentation artifact
The ER diagram SHALL be delivered as a single self-contained HTML file checked into the repository (not a live/build-time generated page), styled with Tailwind and rendering diagrams client-side, that opens correctly by itself in a browser without a build step or network access beyond its own asset requests.

#### Scenario: Page opens standalone
- **WHEN** a reader opens the HTML file directly in a browser (e.g. via `file://` or a static file server)
- **THEN** the page renders its layout, navigation, and all diagrams without requiring a build step

#### Scenario: Page identifies its own freshness
- **WHEN** a reader looks at the top of the page
- **THEN** the page states which point in time / commit context it was generated from, so a reader can judge whether it may be stale relative to the current schema
