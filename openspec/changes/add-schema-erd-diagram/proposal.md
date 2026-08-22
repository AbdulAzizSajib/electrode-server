## Why

`fix-prisma-schema-relations` closed every broken/missing relation in `prisma/schema/*.prisma` (39 models, 25 enums — `prisma validate` now passes cleanly), but the schema has no visual documentation: understanding how 39 models connect means reading 36 separate `.prisma` files by hand. There is no way to see the whole data model, or a single domain of it (catalog, orders, inventory, RBAC, etc.), at a glance. A generated, browsable ER diagram is needed so the team can visually verify the data model and onboard new contributors without re-deriving the relation graph from source.

A fresh full-schema review (triggered by this request) confirms the relation-integrity work holds — zero `prisma validate` errors, all 39 models covered. It also surfaces feature-level gaps that are normal for a schema at this stage but are out of scope here (see Impact): no persisted `Cart`/`CartItem`, no `Wishlist`, no store-wide `Settings` model, no `Tax`/`Currency` configuration entities, and `Product` still supports only one `Category` (not many-to-many). None of these are relation bugs — they are features not yet built — so they are called out for the user to decide on, not silently added.

## What Changes

- Add a static, self-contained HTML documentation page (Tailwind for layout/styling, Mermaid for the actual ER diagrams) that visualizes the full Prisma data model, grouped by domain (Auth & RBAC, Catalog, Inventory & Procurement, Orders & Fulfillment, Payments & Refunds & Returns, Marketing, Support, Audit & Notifications), plus one full-schema overview diagram.
- The page is generated from the current schema as a point-in-time artifact (not a live build step) and checked into the repo alongside the existing `docs/user-manual.html` convention.
- No application code, API, or database changes — this is a documentation-only addition.

## Capabilities

### New Capabilities
- `docs/schema-erd`: An interactive, domain-grouped ER diagram of the Prisma data model, rendered as a self-contained HTML page, that lets a reader visually navigate every model and relationship without reading the raw `.prisma` files.

### Modified Capabilities
<!-- None. The relation-integrity contract (data-model/schema-relations) is unchanged by this documentation-only addition. -->

## Impact

- **Affected files**: adds one new file, `docs/database-erd.html` (naming/location follows the existing `docs/user-manual.html` convention). No other files are touched.
- **Out of scope, flagged for a future decision** (not part of this change): persisted `Cart`/`CartItem`, `Wishlist`, a store-wide `Settings`/config model, `Tax`/`Currency` configuration, and multi-category products (`Product` currently has a single `categoryId`). These are feature additions, not relation defects, and are left for the user to prioritize separately.
- **Maintenance**: because the diagram is generated at a point in time, it can drift from the schema after future changes; `tasks.md` includes a lightweight process note (a checklist comment in the file) for regenerating it, not an automated CI step (out of scope).
