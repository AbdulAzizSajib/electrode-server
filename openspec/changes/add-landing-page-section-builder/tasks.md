## 1. Backend — the stored shape

- [x] 1.1 Add `sectionConfig Json?` to `prisma/schema/LandingPage.prisma`, with a `///` comment beside the existing Json columns documenting the entry shape for both built-in and custom sections, and stating that `NULL` means "never configured" and is what the default-order fallback keys off (design.md D1). Verify `npx prisma generate` succeeds and the generated client carries the field.
- [x] 1.2 Run `npm run migrate --workspace server`, then **open the generated SQL, delete the three `DROP INDEX` lines for `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx`, and copy the NOTE block forward from the previous migration**. Verify by grepping the new migration for `DROP INDEX` and getting no hits, and that the NOTE block is present.
- [x] 1.3 Add the section registry to `landing-page.constant.ts`: the built-in key list in default render order, the `CUSTOM` key named as **the one key that may repeat** (design.md D3, same hazard as `MID_BANNERS`), and the custom-section count limit. Verify the default order matches the current JSX sequence in `LandingPageView.tsx` exactly, section for section.
- [x] 1.4 Add `sectionConfigSchema` to `landing-page.validation.ts` mirroring `homeConfigSchema`: `.strict()` entries, plus a `superRefine` enforcing unique custom `id`s, the custom-section limit, and no repeated built-in key (design.md D6). Verify a well-formed order parses and each rejection case fails with a message naming the offending entry.
- [x] 1.5 Add the payload and result types to `landing-page.interface.ts`, with `sectionConfig` as `.optional()` so an omitted key means "leave unchanged" — the only way the section editor can avoid clobbering content written by the landing page form (design.md D7). Verify `npm run lint --workspace server` passes.
- [x] 1.6 Persist `sectionConfig` in `landing-page.service.ts`, recording an `AuditLogService.record(...)` after the write as every mutating service call does. Verify a service-level round trip stores and reads back the exact sequence sent.
- [x] 1.7 Fire the existing `landing-pages` revalidate tag from **every** mutating path that can change section order or custom content, after the transaction resolves and never inside it. Verify by auditing per Prisma model across `src/`, not per service file, and listing each path found.

## 2. Backend — verification

- [x] 2.1 Write `scripts/verify-landing-section-config.ts` importing the service directly, creating `__verify_*`-prefixed rows and cleaning up in a `finally`. Cover: storing a non-default order returns it unchanged; `NULL` stays `NULL`; an omitted `sectionConfig` leaves an existing one untouched. Verify with `npx tsx scripts/verify-landing-section-config.ts`.
- [x] 2.2 Extend that script with the validation rejections — unknown key, duplicate custom `id`, over the custom-section limit, malformed entry — asserting each is refused rather than stored. Verify the script passes.

## 3. Storefront — resolution

- [x] 3.1 Add the `sectionConfig` field and its entry types to `nextjs/src/types/landing-page.ts`, and map it in `src/services/landing-page.ts`. Verify `npx tsc --noEmit` passes in `nextjs/`.
- [x] 3.2 Write the pure resolution function: stored order + registry → ordered sections to render. Drops unknown keys, appends registry sections the stored order omits at their default position, and returns the default order when the stored value is absent or unreadable (design.md D4, and the spec's "A stored order is resolved against the sections that exist"). Verify with unit tests via `npm run test --workspace nextjs`.
- [x] 3.3 Add unit tests covering each drift case separately — unknown stored key, registry section missing from the stored order, malformed stored value, and `NULL` — since these are the cases that fail silently in production. Verify all pass.
- [x] 3.4 Write the surface-alternation function: surface derived from position in the **resolved, enabled-only** list, with the call-to-action strips keeping their accent wash rather than joining the alternation (design.md D5). Verify with unit tests that no two adjacent rendered sections share a surface, including after a section is disabled.

## 4. Storefront — rendering

- [x] 4.1 Change `LandingPageView.tsx` to fold over the resolved list instead of the fixed JSX sequence, keeping the hero and order form outside the reorderable set so a page can never render without them (design.md, Risks). Verify the page renders and `npx tsc --noEmit` passes.
- [x] 4.2 **Update the header comment in `LandingPageView.tsx`.** It currently states the section order as a deliberate fixed sequence, which this change makes false. Replace it with what now decides the order, what `NULL` means, and where alternation comes from. Verify by reading it back against the new behaviour — the repo treats comments as the spec of record.
- [x] 4.3 Add the custom-section renderer, passing its body through the existing `RichText` + `lib/sanitize-html.ts` path rather than a new sanitiser (design.md D8). Verify a body containing script and event-handler markup renders inert.
- [x] 4.4 Confirm a page with `sectionConfig = NULL` renders the same sections, in the same order, on the same surfaces as before this change. Verify by diffing the rendered section sequence and surface classes against the pre-change output for the same page — this is the single most important check in the change.

## 5. Admin

- [x] 5.1 Mirror the registry, the `CUSTOM` repeat rule and the limit constants into `admin/src/lib/api/landing-pages.ts`, with a comment recording the standing obligation to keep them in step with `server/`. Verify the key list and limit match the backend constants exactly.
- [x] 5.2 Build `admin/src/features/ui/landing-sections/` on `useSettingsDraft`, `useUnsavedChangesGuard` and `ReorderableList`, following `home-sections-page.tsx` (design.md D7). Verify drag-reorder and the enable switch update the draft and mark it dirty.
- [x] 5.3 Make the page send **only** `sectionConfig` on save, never a whole-page payload — the landing page form writes the same row and a superset would clobber its content (design.md D7, Risks). Verify by saving from the section editor and confirming content written by the form survives unchanged.
- [x] 5.4 Add the custom-section editor: create with a generated stable `id`, edit heading/body/layout, delete, and reorder among built-in sections. Verify editing one custom section leaves the others' content, order and enabled state untouched.
- [x] 5.5 Prevent disabling the hero and the order form in the UI, matching the backend's refusal rather than relying on a dismissible warning (design.md, Risks). Verify both controls are unavailable and a crafted request is still refused server-side.
- [x] 5.6 Register the route in **both** `src/routes/nav-config.ts` and `src/routes/app-router.tsx`, with an explicit `<RoleGuard>` in the router; the nav `roles` only controls sidebar visibility and the two are kept in sync by hand. Verify the page is reachable and gated for a role that should not see it.
- [x] 5.7 Confirm a failed save leaves every entered value in place with the reason shown above the fields, as `ResourceFormPage` does. Verify by forcing a validation rejection and checking nothing is reset.

## 6. End-to-end verification

- [x] 6.1 Reorder sections in the admin, save, and confirm the storefront serves the new order on the next request rather than after a cache window — proving the revalidate fire in 1.7 reaches the storefront. Verify against a running storefront.
- [x] 6.2 Disable a populated section, confirm it disappears from the page, re-enable it, and confirm its content returns unchanged (the spec's "A section can be switched off without losing its content"). Verify end to end.
- [x] 6.3 Run `npx tsx scripts/verify-revalidate-tags.ts` to confirm the backend and storefront tag sets still match. Verify it passes.
- [x] 6.4 Run `npm run lint --workspace server`, `npm run test --workspace nextjs` and `npm run test --workspace admin`. Verify all pass, and report any pre-existing failures separately rather than folding them into this change.
- [x] 6.5 Check the rendered page at phone and desktop width for horizontal scrolling and for two adjacent bands sharing a surface, in a reordered configuration and in one with sections disabled. Verify visually at both widths.

## 7. Splitting the product from the order form

Added after the change first shipped: `HERO` rendered the gallery, the copy, the
price and the order form as one unreorderable block, so the one arrangement
campaign pages most often want — the form first, for traffic that already knows
from the ad what it is buying — could not be expressed at all.

- [x] 7.1 Add `ORDER_FORM` to `LANDING_SECTION_KEYS`, to `DEFAULT_LANDING_SECTION_ORDER` directly after `HERO`, and to `LANDING_REQUIRED_SECTION_KEYS` in `landing-page.constant.ts`. **Keep the `HERO` key for the product half** rather than renaming it — every order stored since the editor shipped names it, and a rename would drop that entry on read and refuse it on the next save. Verify `npm run lint --workspace server` passes.
- [x] 7.2 Mirror all three into `frontend/src/lib/landing-sections.ts` (default order, known keys, required keys) and `admin/src/lib/api/landing-pages.ts` (keys, default order, required keys, registry labels). Verify `npx tsx scripts/verify-landing-section-shapes.ts` passes on all three mirrors.
- [x] 7.3 **Repoint `verify-landing-section-shapes.ts` and the other verify scripts at `frontend/`.** They still named the storefront `nextjs/`, so the mirror comparison had been reporting `MISSING` and returning early — the one check that would have caught a drifting key was itself broken. Verify each script now reads its mirrors and passes.
- [x] 7.4 Render both keys from the folded list in `LandingPageView.tsx` and delete the hero block drawn above it, so the two are reorderable like every other section. Update the file's header comment: it stated the hero was outside the fold, which this makes false.
- [x] 7.5 Drop the surface-alternation `offset` default from 1 to 0. It was 1 only because the hero was a band the count could not see; with every band in the list the hazard is gone by construction. Verify no two adjacent content bands share a surface, hero included.
- [x] 7.6 Add the same restore pass to the admin's section editor that the storefront resolver has. Without it a page saved before the split shows a list missing the order form, and the merchant's next save is refused by a rule about a row the screen never showed them.
- [x] 7.7 Verify end to end against a running storefront: the brand, then the product band, then the order form on a different surface; and `npx tsc --noEmit` plus the existing suites green in all three apps.
