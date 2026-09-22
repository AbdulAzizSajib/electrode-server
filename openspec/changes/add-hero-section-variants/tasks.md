## 1. Registry and types

- [x] 1.1 In `src/app/module/store-setting/store-setting.constant.ts`, add `HERO_VARIANTS` as an `as const` tuple in this exact order: `SPLIT_THREE`, `SPLIT_ONE`, `FULL_SLIDER`, `SLIDER_STACK`. Comment that **position 0 is the default** and that `SPLIT_THREE` is the layout the storefront rendered before this change, so the order is load-bearing rather than cosmetic (design.md Decision 2).
- [x] 1.2 Add `HOME_SECTION_VARIANTS` — a partial map from `HomeSectionKey` to a non-empty readonly tuple of layout names, with `HERO: HERO_VARIANTS` as its only entry. Comment that a key absent from the map offers no choice, that this is the sixth place a section key is named (the `HOME_SECTION_KEYS` comment lists the other five), and that `PRODUCT_CARD` / `CATEGORY_GRID` join it in later slices.
- [x] 1.3 Export the derived types: `HeroVariant = (typeof HERO_VARIANTS)[number]`, and a `HomeSectionVariant` union over every tuple in the map.
- [x] 1.4 Add an exported `resolveSectionVariant(key, stored)` helper returning the resolved layout or `undefined` for a key that offers none. One implementation, used by both the reconciler and the verify script, so "absent, unrecognised, or withdrawn → default" exists once (design.md Decision 4).
- [x] 1.5 Extend `HomeSectionConfig` to `{ key, enabled, variant?: HomeSectionVariant }`.
- [x] 1.6 Leave `DEFAULT_HOME_CONFIG` derived and variant-free. Add a short comment recording that this is deliberate — absent already resolves to the default, and a second representation of one state is what reconciliation exists to avoid (design.md Decision 5).

## 2. Validation

- [x] 2.1 In `store-setting.validation.ts`, add `variant: z.string().optional()` to the `.strict()` entry object inside `homeConfigSchema` (~line 485). A bare string here, narrowed by the refinement below, rather than a `z.enum` of every layout across all keys — the per-key check is the one that matters.
- [x] 2.2 Extend the existing `superRefine` so that, per entry: a `variant` on a key with no offering is an issue at path `[index, "variant"]` naming the section; and a `variant` not in that key's tuple is an issue naming the offered values. Keep the duplicate-key check exactly as it is.
- [x] 2.3 Confirm the messages read as a merchant-facing sentence — both clients surface `errorSources[0].message` verbatim.

## 3. Read-time resolution

- [x] 3.1 In `store-setting.service.ts`, change `reconcileHomeConfig`'s `seen` map from `Map<HomeSectionKey, boolean>` to carry `{ enabled, variant }`, reading `variant` off each stored entry without trusting its type.
- [x] 3.2 Emit the resolved variant in **both** rebuild paths — the stored-order walk and the splice that inserts a section the store never saved — via `resolveSectionVariant`. Omit the key entirely for a section that offers none, rather than emitting `undefined`.
- [x] 3.3 Add a comment above the function recording that dropping the variant here is the silent failure this change most risks: the save succeeds, persists, and the value is gone on the next read (design.md Decision 4).
- [x] 3.4 Confirm the public projection's allow-list serves `homeConfig` whole, so no separate entry is needed for the new field.

## 4. Banner placement documentation

- [x] 4.1 In `prisma/schema/enums.prisma` (~line 277), rewrite the three `HERO_*` doc comments so each says which layouts render it and at what shape, instead of describing the single hardcoded hero as if it were the only one.
- [x] 4.2 State in that comment block that a slot a layout does not render keeps its rows untouched, and that no placement is ever added per layout (design.md Decision 6).
- [x] 4.3 Comments only — confirm `npm run generate` produces no migration and `git status` shows no new file under `prisma/migrations/`.

## 5. API contract

- [x] 5.1 In `postman/Ecom.postman_collection.json`, add `variant` to the `homeConfig` entries in the `PATCH /settings` example body, with `SPLIT_THREE` on the `HERO` entry.
- [x] 5.2 Document the same field on the public settings read, noting that the server always resolves it and a client must not default it.
- [x] 5.3 Name the four `HERO` values and the default in the request description, since the collection is the contract of record both clients read.
- [x] 5.4 Run `npx tsx scripts/verify-postman-routes.ts` and confirm it passes.

## 6. Verification

- [x] 6.1 Add `scripts/verify-hero-section-variants.ts`, static and DB-free like `verify-postman-routes.ts`, importing the schema and the reconciler directly.
- [x] 6.2 Assert resolution: absent → `SPLIT_THREE`; unrecognised string → `SPLIT_THREE`; a valid stored layout → itself; a non-`HERO` section → no `variant` key at all.
- [x] 6.3 Assert the round trip end to end — a config carrying `SLIDER_STACK` passes `homeConfigSchema`, then survives `reconcileHomeConfig` with the layout intact. This is the regression guard for the silent-drop failure in 3.1.
- [x] 6.4 Assert rejection: an unknown layout on `HERO`, and any layout on `BRAND_BAR`, both fail validation with the offending index in the issue path.
- [x] 6.5 Assert that a section list with no variants anywhere reconciles byte-identically to what it did before, so an untouched store is provably unaffected.
- [x] 6.6 Assert that reconciliation does not mutate its input — resolution is read-time only and must not rewrite the stored row (design.md Decision 4).

## 7. Close out

- [x] 7.1 Run `npm run build` (`prisma generate && tsc && fix-imports`) and confirm it is clean.
- [x] 7.2 Run `npx tsx scripts/verify-hero-section-variants.ts` and `npx tsx scripts/verify-postman-routes.ts`.
- [x] 7.3 Manually confirm against a running server that `GET /settings/public` reports `variant: "SPLIT_THREE"` on the `HERO` entry for a store that has never chosen one.
- [x] 7.4 Confirm the downstream changes are unblocked and still accurate: `frontend/openspec/changes/add-hero-section-variants-ui` and `admin/openspec/changes/add-hero-section-variants-admin`. Ship in that order (design.md — Migration Plan).
