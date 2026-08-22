## Context

The schema is 39 models / 25 enums across 36 files under `prisma/schema/*.prisma` (see `fix-prisma-schema-relations` for the relation-integrity work that just made this schema fully valid). The project already has a precedent for hand-built, self-contained HTML documentation: `docs/user-manual.html` is a single-file interactive doc (sidebar navigation, page sections, inline `<style>`, no build step, no framework). This change follows the same pattern for a new file, `docs/database-erd.html`.

## Goals / Non-Goals

**Goals:**
- One page that lets a reader visually understand the full data model, both as a whole and one domain at a time.
- Zero build step: open the file, it works — matching `docs/user-manual.html`'s existing convention.
- Accurate as of the point it's generated (39 models, all relations from the now-valid schema).

**Non-Goals:**
- Not a live/auto-regenerating diagram (no CI step, no schema-introspection script wired into a build pipeline) — regenerating it is a manual, occasional task, called out as a checklist note in `tasks.md`.
- Not adding, removing, or renaming any Prisma model/field — purely documentation of the schema as it exists today.
- Not addressing the feature-level gaps found during review (`Cart`, `Wishlist`, `Settings`, `Tax`/`Currency`, multi-category products) — those are listed in `proposal.md` Impact for the user to decide on separately; this diagram will visually make those gaps easier to spot, which is itself useful, but building them is out of scope.

## Decisions

### Decision: Tailwind (CDN) for layout/styling, Mermaid (CDN) for the actual diagrams
**Options considered:**
- (a) Hand-drawn SVG boxes and lines for every entity/relationship.
- (b) A diagramming library requiring a build step (e.g. React Flow via a bundler).
- (c) Tailwind CDN for page chrome (nav, cards, legend, typography) + Mermaid CDN (`erDiagram`) for the diagrams themselves, computed/laid out client-side from a text definition.

**Choice: (c).** Hand-drawn SVG (a) does not scale to 39 entities and would need manual re-layout on every schema change — brittle and slow to produce correctly. A bundler-based library (b) breaks the "open the file, it works" requirement the existing `docs/user-manual.html` sets. Mermaid's `erDiagram` syntax is a plain-text description of entities/relationships/cardinality that Mermaid lays out automatically in the browser via a single `<script>` tag — this keeps the file self-contained (no build step) while staying accurate and maintainable (regenerating the diagram means editing text blocks, not redrawing boxes). This directly satisfies "html + tailwind" from the request: Tailwind visibly drives the page's look or navigation, Mermaid is the practical way to make the actual ER diagram both correct and maintainable inside a single static file.

**Trade-off accepted:** Requires the CDN scripts (Tailwind Play CDN, Mermaid CDN) to load over the network the first time the page is opened; if opened fully offline, the layout/diagrams won't render (only the raw HTML skeleton will). Matches the existing `docs/user-manual.html` posture (that file also assumes normal internet access for a documentation page) so this is a consistent, accepted trade-off, not a new one.

### Decision: One overview diagram + one Mermaid `erDiagram` per domain group
A single 39-entity Mermaid diagram is technically renderable but not "legibly readable" (spec requirement) at a glance — text labels overlap and the layout algorithm struggles past ~15-20 entities. Splitting into domain groups (Auth & RBAC, Catalog, Inventory & Procurement, Orders & Fulfillment, Payments/Refunds/Returns, Marketing, Support, Audit & Notifications) keeps each diagram small enough to read, while the overview diagram (all 39 entities, relationships only — trimmed field lists) gives the "whole system at a glance" view the user asked for. Domain boundaries follow the file grouping already implicit in `prisma/schema/*.prisma` (e.g. `Warehouse`/`Stock`/`StockMovement`/`Supplier`/`PurchaseOrder*` → Inventory & Procurement).

### Decision: Static point-in-time generation, not a build-time script
Building a schema-to-Mermaid generator script (parsing `.prisma` AST, e.g. via `@prisma/internals`) would keep the diagram perpetually accurate, but is a meaningfully bigger, separate piece of tooling work than "add a diagram page," and this project has no existing doc-generation pipeline to hook into. Given `docs/user-manual.html` is also hand-maintained (not generated), a hand-authored-from-the-current-schema HTML file is consistent with the project's existing documentation approach. The page states its generation point-in-time (per the spec's "Page identifies its own freshness" scenario) so staleness is visible rather than silent.

## Risks / Trade-offs

- **[Risk] The diagram silently goes stale as the schema evolves.** → Mitigation: page header states the point-in-time it reflects; `tasks.md` includes a maintenance checklist note (manual regeneration reminder) rather than pretending this is automated.
- **[Risk] Manually transcribing 39 models/relations from `.prisma` files into Mermaid syntax is error-prone (a transcription mistake would misrepresent the real schema).** → Mitigation: `tasks.md` includes an explicit cross-check step — every model name and relation in the generated Mermaid source is diffed against `prisma/schema/*.prisma` before the page is considered done.
- **[Risk] CDN dependency (Tailwind Play CDN + Mermaid CDN) means the page needs network access on first load.** → Accepted, matches `docs/user-manual.html`'s existing posture; noted in Decisions above.

## Migration Plan

Not applicable — this is an additive, standalone documentation file with no impact on running code, the database, or any deployed service. No rollback plan needed beyond deleting the file.
