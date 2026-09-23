## 1. Backend — schema and storage

- [x] 1.1 Add the `SECTION_KEYS` ordered registry and `DEFAULT_HOME_CONFIG` (all sections enabled, registry order) to `server/src/app/module/store-setting/store-setting.constant.ts`, with a doc-comment stating that the array is simultaneously the closed key set, the default order and the default config, and that `nextjs` and `admin` mirror it — verify by importing it in a `node -e`/`tsx` one-liner and confirming eleven keys in the order given in `specs/storefront-home-sections/spec.md`
- [x] 1.2 Add the nullable `homeConfig Json?` column to `server/prisma/schema/StoreSetting.prisma` with a `///` doc-comment recording the read contract from design.md Decision 2 (reconcile against the registry — NOT `merge()`, NOT the per-key spread `catalogConfig` uses, because the value is an ordered array) and that Zod is the only gate — verify `npx prisma validate` passes
- [x] 1.3 Generate the migration with `pnpm --filter ./server migrate`, then **open the generated SQL, delete the three `DROP INDEX` lines for `Product_name_trgm_idx` / `Product_sku_trgm_idx` / `Brand_name_trgm_idx`, and copy the NOTE block forward from the most recent migration** — verify the final SQL contains no `DROP INDEX`, and that `psql \di` still lists all three trigram indexes after the migration applies
- [x] 1.4 Add `homeConfigSchema` to `store-setting.validation.ts` — `.strict()`, an array of `{ key, enabled }` with `key` constrained to `SECTION_KEYS`, `enabled` a boolean, no duplicate keys via `superRefine`, and register it as `homeConfig: homeConfigSchema.optional()` on the update schema (`.optional()` alone — there is no third "unset" state) — verify a `PATCH /settings` with an unknown key, a duplicate key, or a non-array is rejected 400, and a valid list is accepted

## 2. Backend — reconciliation and publication

- [x] 2.1 Implement the reconciliation function in `store-setting.service.ts` per design.md Decision 2: drop unregistered keys, collapse duplicates to first occurrence, splice missing registry sections in at their registry-relative position enabled, and resolve a null or malformed value to the full default list — verify with the script in 2.4
- [x] 2.2 Add `homeConfig` to `DEFAULT_PUBLIC_SETTINGS` and to the public projection in `store-setting.service.ts`, running the stored value through reconciliation, with a comment explaining why neither `merge()` nor the `catalogConfig` per-key spread applies to an ordered array — verify `GET /settings/public` on an unconfigured store returns all eleven sections enabled in registry order
- [x] 2.3 Confirm `revalidateStorefront(STORE_SETTINGS_TAG)` already fires on the `homeConfig` write path (it fires on every settings write) and that no new cache tag is needed — verify by saving `homeConfig` and observing the existing tag ping in the server log
- [x] 2.4 Write `server/scripts/verify-home-config.ts` importing the service directly, covering: null → full default; unknown key dropped; missing key appended enabled in registry position; stored order and enabled flags preserved; duplicate keys collapsed; malformed value → full default; all-disabled list stored and returned as-is — verify `npx tsx scripts/verify-home-config.ts` exits 0
- [x] 2.5 Run `pnpm --filter ./server lint` and `pnpm --filter ./server build` — verify both pass and that `scripts/fix-imports.js` ran as part of the build

## 3. Storefront — types and fallback

- [x] 3.1 Add the `HomeSectionKey` union and `HomeConfig` type to `nextjs/src/types/store-settings.ts` and add `homeConfig` to the `StoreSettings` interface — verify `pnpm --filter ./nextjs build` type-checks
- [x] 3.2 Add the mirrored section registry and the `homeConfig` entry to `FALLBACK_SETTINGS` in `nextjs/src/services/store-settings.ts` as the full enabled default list, with the standing "mirrors the backend's `DEFAULT_HOME_CONFIG` — keep in step with server/" comment — verify that with the API unreachable the homepage still renders every section (spec: "The homepage renders in full when settings cannot be read")

## 4. Storefront — conditional rendering

- [x] 4.1 Rework `nextjs/src/app/(shop)/page.tsx` to read `settings.homeConfig` after the existing `siteMode` redirect and derive the enabled key set, leaving the `LANDING_PAGE` redirect untouched and still short-circuiting before any section is considered — verify the redirect still fires in `LANDING_PAGE` mode
- [x] 4.2 Replace the positional `Promise.all` with a keyed fetch set built from the enabled sections per design.md Decision 4, so `getProducts`/`getCampaignByPlacement`/`getTestimonials`/`getRecentBlogPosts` are only called for enabled sections, each still resolving rather than rejecting on failure — verify via server logs that disabling Deal of the Week and Blog issues neither request, and that disabling all product-backed sections issues no product query
- [x] 4.3 Replace the fixed JSX with a map over the reconciled enabled list using a per-key render map, keeping every existing emptiness guard alongside its section so enabled and non-empty remain independent conditions, and keeping `DEAL_OF_WEEK`'s no-fallback comment — verify an enabled section with no content renders nothing including its heading, and a disabled section with content renders nothing
- [x] 4.4 Add a header comment to `(shop)/page.tsx` explaining why the fetch set is built rather than fixed, citing `openspec/changes/add-homepage-section-toggles` and design.md Decisions 4 and 5 — verify the comment names the concrete failure (a disabled section otherwise still pays for its data)
- [ ] 4.5 Confirm the all-disabled case renders the `(shop)` chrome with no sections between and returns 200 — verify by saving an all-off config and loading `/`
- [x] 4.6 Run `pnpm --filter ./nextjs lint`, `test` and `build` — verify all three pass

## 5. Admin — API layer and shared reorder control

- [x] 5.1 Add `HomeSectionKey`, `HomeConfig`, the mirrored `SECTION_REGISTRY` (key, label, and the one-line description of what each section shows) and `DEFAULT_HOME_CONFIG` to `admin/src/lib/api/store-settings.ts`, plus `homeConfig` on the settings record and the update input — verify `pnpm --filter ./admin build` type-checks
- [x] 5.2 Lift `ReorderableRow` out of `admin/src/features/ui/home-slider/home-slider-page.tsx` into `admin/src/features/ui/components/`, generalised over its item type with a `getKey` prop instead of being typed to `Banner[]`, and update the home-slider page to consume it from its new location — verify the home slider's drag-to-reorder still works and `pnpm --filter ./admin test` passes
- [x] 5.3 Add a vitest file for the generalised reorder helper alongside the existing `settings-editor-utils.test.tsx`, covering move-up, move-down, move-to-end and a no-op move onto itself — verify `pnpm --filter ./admin test` passes

## 6. Admin — the Home Sections editor

- [x] 6.1 Create `admin/src/features/ui/home-sections/home-sections-page.tsx` following the settings-editor pattern (`useSettingsDraft` + `useUnsavedChangesGuard`, `EditorActions`, `UnsavedChangesDialog`), seeded from `data && (data.homeConfig ?? DEFAULT_HOME_CONFIG)` so an unconfigured shop shows every section enabled rather than reading as off — verify the page loads with all eleven sections enabled on a fresh store
- [x] 6.2 Render each section as a row with a drag handle, up/down buttons, its name, its one-line description and a `Switch`, so reordering is reachable by keyboard and on touch and not only by drag (design.md Decision 7) — verify reordering works by both drag and buttons, and that the tab order reaches every control
- [x] 6.3 Have the save write **only** `{ homeConfig }` through `useUpdateStoreSettings`, with the standing comment about the disjoint-key-set arrangement across the settings editors — verify saving this page leaves `catalogConfig`, `checkoutConfig`, `theme`, `mainNav` and `footerColumns` unchanged in the database
- [x] 6.4 Show an inline warning while every section is disabled, stating that the homepage will have no sections, without blocking the save (design.md Decision 8) — verify the warning appears when the last section is switched off and that the save still succeeds
- [x] 6.5 Leave the draft intact and show the reason when a save fails — verify by forcing a 500 that the merchant's reordering and switches remain on screen with the error above them
- [x] 6.6 Register the page in **both** `admin/src/routes/nav-config.ts` (under the UI section, near Catalog Setting) and `admin/src/routes/app-router.tsx` (lazy route plus a `RoleGuard` matching the nav section's roles) — verify the sidebar entry appears for OWNER/ADMIN, the route loads, and a STAFF user is refused

## 7. End-to-end verification

- [ ] 7.1 With all three apps running via `pnpm dev`, disable Hero, Brand Bar, Featured Categories, Featured Products, Perks Bar, Deal of the Week, New Arrivals, Testimonials and Blog, leaving Mid Banners and Best Selling on — verify the storefront homepage renders only those two sections after the revalidation ping, with no redeploy
- [ ] 7.2 Reorder Best Selling above Mid Banners and save — verify the storefront renders them in the new order
- [ ] 7.3 Re-enable a previously disabled section — verify it reappears at the position it held before it was disabled, and that its content (testimonials, blog posts) is intact and was never deleted
- [ ] 7.4 Simulate a section shipping after a config was saved by removing one key from a stored `homeConfig` row directly in the database — verify that section renders enabled in its registry-default position and that the merchant's order for every other section is unchanged
- [ ] 7.5 Write an unrecognised key and a malformed value into `homeConfig` directly in the database — verify the unknown key is ignored and the malformed value falls back to the full default list, with the homepage rendering successfully in both cases
- [x] 7.6 Run `pnpm build` at the repo root — verify server, admin and shop all build in that order
- [x] 7.7 Run `openspec validate --change add-homepage-section-toggles --strict` — verify it reports no issues

> **7.1–7.5 and 4.5 are not yet verified.** These six all require a live database, and the Neon instance became unreachable (`P2001`/`P2010`, `DatabaseNotReachable`) partway through this session — after the migration had applied and `GET /settings/public` had been confirmed returning all eleven sections. Nothing in this change caused it and nothing in it depends on the outcome; the reconciliation rule those cases exercise is covered independently and passing in `scripts/verify-home-config.ts`. Re-run them once the database is back.
