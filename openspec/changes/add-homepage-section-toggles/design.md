## Context

See `proposal.md` — Why. The constraints that actually shape this design:

**The homepage fetches before it renders.** `(shop)/page.tsx` issues six concurrent requests in one `Promise.all`, destructured positionally, then renders fixed JSX. Section visibility today is a byproduct of `products.length > 0` guards. Making sections configurable therefore has to reach the fetch layer, not just the JSX — otherwise a shop with nine sections off still pays for nine sections of data.

**`StoreSetting` is a singleton with seven independent admin editors** sharing one partial `PATCH /settings`. They coexist only because each writes a disjoint key set. A new editor joins that arrangement or breaks it.

**Existing blob-read precedent, and its scar tissue.** `checkoutConfig` was read with a wholesale `merge()`, so rows written before `delivery` existed came back without it and the storefront had nothing to render — fixed by the `withDeliveryDefault` shim. `catalogConfig` was built afterwards with a per-key spread specifically to avoid needing one. This change's value is an **ordered array**, so neither a `merge()` nor a per-key spread applies; it needs its own read rule, designed correctly the first time.

**The storefront already reads settings on every page.** `(shop)/layout.tsx` and the root layout both call `getStoreSettings()`, a tagged fetch deduped within the render pass. Anything on that payload is free to the homepage.

**The admin already has drag-to-reorder without a library.** `home-slider-page.tsx` has a `ReorderableRow` over the native HTML5 drag API, and `settings-editor-utils.tsx` exports `moveItem`. Arrow-button reordering exists too, in `settings-editor.tsx`.

## Goals / Non-Goals

**Goals:**

- One stored value that carries both order and enablement, readable by the storefront with no extra request.
- A read rule that survives sections being added or removed in later releases, with no data migration and without discarding a merchant's saved order.
- Disabling a section removes its data fetch, not just its markup.
- The registry defined once per app, with the three copies explicitly obligated to each other.

**Non-Goals:**

- **Per-section content configuration.** Section titles, product counts, which categories appear — all stay as they are. This change decides *whether* and *where*, not *what*.
- **Toggling site-wide chrome.** Out of scope per the proposal; the header and footer are rendered by a layout on every route and their removal is a different decision.
- **Adding new sections.** The registry is exactly the eleven blocks the homepage renders today.
- **Per-page composition anywhere else.** Category, product and blog pages keep their fixed layouts.
- **Section-level A/B testing, scheduling, or per-audience variation.** One configuration, one homepage.

## Decisions

### Decision 1 — One `homeConfig` Json column, not eleven boolean columns

An ordered array of `{ key, enabled }` on a single nullable `Json` column.

Eleven boolean columns would express enablement but not order, and adding a twelfth section would be a schema migration every time. An `Int` sort column per section would be worse: order becomes eleven independent numbers that can collide or leave gaps, and nothing stops two sections claiming position 3.

An array makes order intrinsic — position *is* the order — so it cannot be internally inconsistent. The cost is that Postgres constrains nothing about the value, which is the standing arrangement for every blob on this row: **the Zod schema is the only gate**, exactly as `StoreSetting.prisma` already states for `mainNav`, `theme`, `checkoutConfig` and the rest.

Nullable with no backfill. Null means "never configured" and resolves to the full default list, so the migration is additive and no existing storefront changes on deploy.

**Alternative considered — a `HomeSection` table.** A row per section with a `sortOrder` and an `enabled` flag. Rejected: eleven rows of static reference data behind a join, on a payload that is read on every page of the storefront, to model a value that is conceptually one setting. It would also need seeding, which `StoreSetting` deliberately avoids by having defaults resolve at read time.

### Decision 2 — Reconcile against the registry on read; never trust the stored list's completeness

Neither `merge()` nor the per-key spread works on an array. The read rule is:

1. Take the stored list; drop entries whose key is not in the registry; collapse duplicates to first occurrence.
2. For each registry section missing from the result, splice it in at the position implied by the registry's default order relative to its neighbours, enabled.
3. Emit the result.

Step 2 is the whole point. **A section added in release N+1 must render for a merchant who saved their config in release N** — without it, shipping a new section means it silently never appears for any existing shop, which is indistinguishable from the feature being broken. Appending enabled (rather than disabled) also matches how every other default on this row is chosen: reproduce what the storefront would do if the setting did not exist.

Step 1's drop is the mirror case — a removed section must not crash a render or leave a hole.

Malformed input (not an array, entries that are not objects, missing keys) resolves to the full default list rather than throwing. The homepage failing to render is a worse outcome than ignoring a corrupt value, and this is the same direction every other public-projection fallback on this row already fails in.

Reconciliation lives in `store-setting.service.ts`'s public projection — **one implementation, on the server**, so the storefront and the admin cannot disagree about what a stored config means.

### Decision 3 — The section registry is the ordering authority, and it is mirrored three times

`SECTION_KEYS` in `store-setting.constant.ts` is an ordered array. It is simultaneously the closed key set, the default order and — via "all enabled" — the default config. Three facts from one declaration, so they cannot drift apart.

It must be mirrored in `nextjs` (for `FALLBACK_SETTINGS`, which must render the full homepage when settings are unreachable) and in `admin` (which reads the row as-is and cannot otherwise tell "unconfigured" from "configured to the default"). That is the existing obligation `CLAUDE.md` records for `SETTINGS_LIMITS`, `DEFAULT_CATALOG_CONFIG` and `FALLBACK_SETTINGS`, and the mirrors carry the same explicit "keep in step with server/" comment.

Keys are `SCREAMING_SNAKE_CASE` strings matching the other enum-ish values on this row (`SiteMode`, `CourierProvider`, banner placements). They are **not** a Prisma enum: a Prisma enum inside a Json column buys no database enforcement, and adding a value would be a migration for what is a presentation list.

### Decision 4 — Build the fetch set from the enabled sections, keyed not positional

The current `Promise.all` destructures six results positionally. Conditional fetching cannot use that shape — a skipped fetch would shift every subsequent binding.

Instead: derive the enabled key set, then build an object of only the promises those keys need, await it, and render by looking each section's data up by key. Sections needing no fetch (`HERO` fetches its own banners internally; `BRAND_BAR` and `PERKS_BAR` read local constants) contribute nothing to the set.

Two notes on the boundary:

- `HERO` and `MID_BANNERS` fetch their own banners inside themselves. Disabling them stops the fetch because the component is never rendered — no change needed for those.
- Deduplication still holds: `getBannersByPlacement` is a tagged fetch and `Hero` and `MidBanners` both call it, which is one cached read, not two requests. That does not change here.

Each fetch keeps its current resolve-rather-than-reject behaviour, so one section's outage shortens the page rather than failing it — which is the existing guarantee and is now a spec requirement.

### Decision 5 — Render by mapping the resolved list, with a per-key render map

The fixed JSX becomes a map over the reconciled, enabled list, with a lookup from key to element. The alternative — eleven `{config.HERO && <Hero />}` guards in the existing fixed order — cannot express reordering at all, which is half the feature.

The existing emptiness guards move into the render map alongside each section, so **enabled and non-empty stay two independent conditions** (spec: "Enabled and non-empty are independent conditions"). A section whose data came back empty returns `null` from its entry and renders nothing, exactly as today.

`DEAL_OF_WEEK` keeps its no-fallback rule: no campaign means no section, never "any discounted product", because a countdown over products with no deadline is a lie. That comment stays.

### Decision 6 — Extend the existing settings payload; no new cache tag

`homeConfig` joins the public projection's allow-list, so the storefront gets it from the `getStoreSettings()` call the layout already makes. No second request, no second cache, no second staleness window — the same reasoning `siteMode` is on this row for.

`store-setting.service.ts` already fires `revalidateStorefront(STORE_SETTINGS_TAG)` on every settings write, so a save invalidates the storefront's tag with no new wiring. The 30-second `SETTINGS_REVALIDATE_SECONDS` window remains the floor of correctness if that ping fails.

### Decision 7 — Native drag reorder, reusing what the panel already has

No new dependency. `home-slider-page.tsx` already implements `ReorderableRow` over the native HTML5 drag API against `moveItem` from `settings-editor-utils.tsx`, for precisely this reason ("a drag library would be a new dependency… the panel has no other sortable surface to amortise it against").

This change gives the panel its second sortable surface, so `ReorderableRow` is **lifted into `features/ui/components/`** and generalised over its item type rather than copied. It is currently typed to `Banner[]` and keyed on `banner.id`; generalising means an item type parameter and a `getKey` prop.

**Drag alone is not enough.** Native HTML5 drag is unusable by keyboard and unreliable on touch, and merchants administer from tablets. Each row therefore also carries up/down buttons — the same affordance `settings-editor.tsx` already renders for header and footer links. Drag is the fast path; the buttons are the accessible one.

### Decision 8 — All-off is permitted, warned, and never silently corrected

A merchant may disable everything. The save succeeds and stores exactly that.

Treating an empty list as "unconfigured" and substituting defaults would make the state unreachable and, worse, unexplainable — the merchant turns everything off, saves, and the homepage is unchanged. The admin instead surfaces an inline warning while the state is pending, which is the honest version of the same protection.

This is also why reconciliation's "append missing sections enabled" is keyed on *absence from the list*, not on *the list being empty*: an explicitly-disabled section stays in the list with `enabled: false`, so it is never re-added.

### Decision 9 — Verify script over the reconciliation rule

`server/` has no test framework; testing is `scripts/verify-*.ts` importing services directly. Reconciliation is the part of this change with real logic and real failure modes, so `scripts/verify-home-config.ts` covers: null → full default; unknown key dropped; missing key appended enabled in registry position; stored order and flags preserved; duplicates collapsed; malformed value → full default. It creates no rows, so it needs no `__verify_*` cleanup.

The admin's reorder helper gets a vitest file alongside the existing `settings-editor-utils.test.tsx`.

## Risks / Trade-offs

**A merchant hides a section and reads it as a bug.** → The admin states per row what turning it off does, in the same voice `catalog-settings-page.tsx` uses. Nothing is deleted, so the recovery is one switch.

**The three registry copies drift.** → Same standing risk as every other mirrored constant here, handled the same way: explicit cross-referencing comments, and the server remains the only authority — the mirrors are fallbacks and admin-seed defaults, never inputs to what the storefront renders when the API is reachable.

**A new section ships and merchants get it enabled without asking.** → Deliberate, per Decision 2: the alternative is a new section that never appears for any existing shop. It matches how every other default on this row is chosen, and it is one switch to undo. Worth calling out in release notes.

**Keys become permanent API surface.** → Accepted and stated in the spec. Renaming a key would orphan every stored config that names it. A section can be renamed in the UI freely; only the key is frozen.

**Someone edits the row directly and writes garbage.** → Reconciliation is a read-side rule, so a malformed value degrades to the full default rather than breaking the homepage. This is the same defensive read `siteMode` already performs against a hand-edited row.

**Reordering produces a layout nobody designed.** Sections carry their own backgrounds and spacing — `PERKS_BAR` is a full-bleed brand-coloured strip, the rest sit on the page background. Some orders will look worse than the default. → Accepted: the merchant sees their own homepage immediately, and the default order is one reset away. Not worth constraining which orders are legal.

**Conditional fetching makes the homepage's data flow less obvious than a flat `Promise.all`.** → Mitigated by keying results rather than destructuring positions, which is what made the old shape rigid in the first place, plus a header comment explaining why the fetch set is built rather than fixed.

## Migration Plan

1. **Backend, additive.** Add the `homeConfig` column, registry constant, Zod schema, reconciliation in the public projection, and the verify script. One migration — **delete the three `DROP INDEX` lines and carry the NOTE block forward**, per `CLAUDE.md`. Deployable alone: the field is published and nothing reads it yet.
2. **Storefront.** Mirror the type and `FALLBACK_SETTINGS` entry, rework `(shop)/page.tsx`. With every shop resolving to the full default list, the rendered homepage is byte-identical to today's — that equivalence is the checkpoint before step 3.
3. **Admin.** Lift `ReorderableRow`, add the editor page, register it in **both** `nav-config.ts` and `app-router.tsx` with matching role gating.

**Rollback.** Steps 3 and 2 revert independently; reverting step 2 restores the fixed homepage while leaving stored configs intact and inert. The column stays — dropping it would discard merchant configuration for a rollback that does not need it, and an unread nullable column costs nothing.

## Open Questions

None. The scope boundary (homepage sections only, not site chrome) and the ordering requirement were both settled with the user before these artifacts were written.
