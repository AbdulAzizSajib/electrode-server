## 1. Schema and migration

- [x] 1.1 Add a nullable `perks Json?` column to `prisma/schema/StoreSetting.prisma`, documented like the presentation blobs beside it: the shape, that Zod is the only gate, that null and `[]` differ, and that `PERKS_BAR` in `homeConfig` still owns whether the band renders.
- [x] 1.2 Hand-write `prisma/migrations/20260926100000_add_perks_strip_content/migration.sql` — one `ADD COLUMN`, no backfill, with the reasoning and the standing trigram-index note.
- [x] 1.3 `npm run generate`, and confirm `npx tsc --noEmit` is clean against the regenerated client.

## 2. Server

- [x] 2.1 `DEFAULT_PERKS` in `store-setting.constant.ts`, reproducing the storefront's four hardcoded columns verbatim with `lucide:*` Iconify names. Note the two hand-kept mirrors.
- [x] 2.2 Add it to both `STOREFRONT_SEED_DEFAULTS` and `DEFAULT_PUBLIC_SETTINGS`.
- [x] 2.3 `MAX_PERKS` and `perksSchema` in `store-setting.validation.ts` — `.strict()`, all three fields required, capped, with the cap's message naming the limit.
- [x] 2.4 `perks: perksSchema.optional()` on `updateStoreSettingZodSchema`; `.optional()` and **not** `.nullable()`, matching `middleBarLinks`.
- [x] 2.5 `IPerk` and `perks?: IPerk[]` in `store-setting.interface.ts`.
- [x] 2.6 One line in the public projection's allow-list: `perks: merge(stored?.perks, DEFAULT_PUBLIC_SETTINGS.perks)`. The update path needs nothing — it passes the validated payload straight through.
- [x] 2.7 Document `perks` on both settings requests in `postman/Ecom.postman_collection.json`; re-run `npx tsx scripts/verify-postman-routes.ts` (no new route, so no new drift).

## 3. Admin panel

- [x] 3.1 `Perk`, `DEFAULT_PERKS` and the `SETTINGS_LIMITS` entries in `admin/src/lib/api/store-settings.ts`; `perks` on both the read and the update payload types.
- [x] 3.2 Reword the `PERKS_BAR` registry entry so it reads as an editable block rather than a fixed one.
- [x] 3.3 `PerksFields` in `home-sections-page.tsx`: icon/title/line per row, add, remove, reorder, capacity note, no icon preview.
- [x] 3.4 Fold `perks` into the page's single draft — seeded from `DEFAULT_PERKS` when the stored column is null — so the unsaved-changes guard and the one Save bar cover a wording edit exactly as they cover a reorder.
- [x] 3.5 Validate blank fields before the round trip, mark the offending inputs, focus the first, and say why *outside* the panel so the reason survives the panel being shut.
- [x] 3.6 Let the page open that panel on a refusal: `SectionRow`'s disclosure becomes optionally controlled, so the refusal opens it from the same handler rather than from an effect (the `react-hooks/set-state-in-effect` rule forbids the effect, and the controlled version needs no second copy of the state).
- [x] 3.7 `perks-strip-editor.test.tsx` — the unconfigured store keeps its band across an unrelated save, an edit round-trips, capacity holds, and a blank field is refused visibly.
- [x] 3.8 Update the payload-key assertion in `section-layout-preserved.test.tsx`: this page now writes three keys.

## 4. Storefront

- [x] 4.1 `Perk` and `perks: Perk[]` in `types/store-settings.ts`.
- [x] 4.2 `FALLBACK_SETTINGS.perks` and the array repair in `services/store-settings.ts`, mirroring how `middleBarLinks` is handled so an emptied band survives an outage as empty.
- [x] 4.3 Rewrite `components/home/PerksBar.tsx` to take `perks`, resolve icons through `@iconify/react`, return null on an empty list, and follow the list's length for its column count.
- [x] 4.4 Pass `settings.perks` from `app/(shop)/page.tsx`, and correct the route's comment about which sections fetch nothing.
- [x] 4.5 Delete `perks` from `data/content.ts` and add it to that file's list of what is now merchant-managed.

## 5. Verification

- [x] 5.1 `npx tsc --noEmit` in all three apps (admin's three pre-existing errors are untouched and unrelated).
- [x] 5.2 `npm --prefix admin run lint` — no new findings (the one remaining error is pre-existing in `use-order-alert.ts`).
- [x] 5.3 `npx vitest run src/features/ui/home-sections/` in `admin` — 32 passing.
- [x] 5.4 `npm --prefix frontend run test` — 300 passing.
- [x] 5.5 `npx prisma migrate deploy` against the live database — the one pending migration applied, `migrate status` reports the schema up to date. (`deploy` rather than `migrate dev`: it only applies pending migrations and can never reset.)
- [x] 5.6 Extend `scripts/verify-site-settings.ts` with the perks strip — 12 checks over the schema, the cap, the empty-versus-unset distinction and the defaults. **This first meant repairing the script:** three `reconcileHomeConfig` calls predated `add-promo-banner-groups`' second parameter and crashed on `for…of undefined`, which had made every check below them unreachable; two more assertions had frozen the catalog blob's flag set and the home registry's length. All pre-existing, all fixed, script green.
