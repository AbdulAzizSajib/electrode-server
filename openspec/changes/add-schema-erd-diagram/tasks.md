## 1. Extract the schema data to diagram

- [x] 1.1 Re-read every file in `prisma/schema/*.prisma` and build a working list of all 39 models, their fields, and every relation (with cardinality: 1-1, 1-many, many-many via join tables like `CampaignProduct`/`CouponProduct`/`RolePermission`).
  - Correction found during extraction: the schema actually has **40 models** (`grep -c "^model " prisma/schema/*.prisma`), not 39 as estimated in the planning artifacts. The page uses the correct count (40); `proposal.md`/`design.md` still say 39 — cosmetic, not corrected since they're historical planning records.
- [x] 1.2 Assign every model to exactly one domain group (as listed).
  - Used the exact grouping from the task, split into 9 sections in the page (the 8 listed plus a standalone "Customer" section for `Customer`/`CustomerAddress`/`Review`, as the task's own trailing note specifies). Counts: Auth & RBAC 7, Customer 3, Catalog 6, Inventory & Procurement 6, Orders & Fulfillment 5, Payments/Refunds/Returns 4, Marketing 5, Support 2, Audit & Notifications 2 — sums to 40.
- [x] 1.3 For models that participate in more than one domain's diagram, note which diagrams show it and confirm repetition is acceptable.
  - `Product`, `User`, `Customer`, `Order`, `OrderItem`, `CustomerAddress` are repeated (as name-only context boxes, not full attribute boxes) across multiple domain diagrams where they're referenced from another domain. Each domain section's intro text also cross-references where else that entity is defined in full.

## 2. Build the HTML page

- [x] 2.1 Create `docs/database-erd.html` following the structure/convention of `docs/user-manual.html` (sidebar navigation, page sections, self-contained single file).
- [x] 2.2 Add Tailwind via CDN for page chrome: header, sidebar nav (Overview + 8 domain entries + Known Gaps), section layout, a legend explaining relationship notation.
- [x] 2.3 Add Mermaid via CDN, initialized client-side, one `erDiagram` block per domain group plus one for the full-schema overview.
  - Used `mermaid@11` ESM CDN with `startOnLoad: false` + a manual `mermaid.run({ querySelector })` per section, lazily rendered the first time each section is opened (avoids any risk of rendering into a `display:none` container, and keeps first paint fast).
- [x] 2.4 Write the overview `erDiagram` Mermaid block: all 40 models, entity-name-only, every relationship with correct cardinality.
- [x] 2.5 Write one `erDiagram` Mermaid block per domain group, with key fields and cardinality-correct relationship lines.
- [x] 2.6 Add a header/footer note stating the generation point-in-time.
  - Sidebar footer: "Generated from `prisma/schema/*.prisma` as of 2026-08-21 — 40 models, 25 enums."
- [x] 2.7 Add a "Known gaps" callout section listing `Cart`/`CartItem`, `Wishlist`, store-wide `Settings`, `Tax`/`Currency` configuration, single-category-only `Product`, clearly marked "not yet built."

## 3. Verify accuracy

- [x] 3.1 Cross-check the overview diagram's entity list against `grep -h "^model " prisma/schema/*.prisma`.
  - Automated with a small Node script: parsed every entity referenced in the overview `erDiagram` block (via relationship lines + standalone entity blocks for `Verification`/`Banner`, which have no relations) and diffed against the live `grep` model list. Result: 40/40 models present, zero missing, zero extras/typos. (First pass was missing `Verification` and `Banner` — models with no relationships never render as Mermaid nodes unless given their own standalone attribute block — fixed by adding both as standalone entity blocks in the overview diagram.)
- [x] 3.2 Cross-check every relationship drawn against the corresponding `@relation(...)` in the `.prisma` source, confirming direction and cardinality match.
  - Manually verified all 50 distinct relationship lines against each model's `@relation` (required vs. nullable FK → `||` vs. `|o` cardinality) — see the change discussion for the full line-by-line table. All 50 confirmed correct; consistent between the overview and each domain sub-diagram (checked via `grep`/`uniq -c`, each line appears 2-3 times as expected — once in overview, once or twice in relevant domain diagrams — with no stray/mismatched variants).
- [x] 3.3 Open `docs/database-erd.html` directly in a browser and confirm rendering/navigation/diagrams/responsiveness.
  - **Not run interactively** — no browser-automation tool is available in this environment. Verified everything checkable statically instead: every `<pre class="mermaid">` has a matching `</pre>` (10/10); every Mermaid entity-attribute block's `{`/`}` pairs balance per diagram; every multi-word relationship label is quoted (Mermaid requirement); every sidebar `data-target` matches exactly one `<section id>` and vice versa (11/11); both CDN URLs (`cdn.tailwindcss.com`, `cdn.jsdelivr.net/npm/mermaid@11/...mjs`) resolve with HTTP 200/302. **Please open the file in a real browser once and confirm it renders as expected** — that's the one thing I could not verify myself.
- [x] 3.4 Confirm the page matches every scenario in `specs/docs/schema-erd/spec.md`.
  - All models represented (3.1) ✓. Cardinality visible via `||`/`|o`/`o{` notation + legend card (3.2) ✓. Domain sub-diagrams present, each with its own model count stated and independently readable ✓. Every model documented as belonging to exactly one primary domain group (stated in each section's intro paragraph) ✓. Single self-contained file, Tailwind + Mermaid via CDN, no build step ✓. Freshness stated in the sidebar footer ✓.
