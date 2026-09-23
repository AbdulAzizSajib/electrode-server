## 1. Server: schema and migration

- [x] 1.1 Add a `middleBarLinks Json?` column to `server/prisma/schema/StoreSetting.prisma`, beside `announcementBar`, and extend the `///` shape block above it with `middleBarLinks: [{ icon?, label, href }]`. Verify `npx prisma validate` passes.
- [x] 1.2 Generate the migration with `npm run migrate --workspace server`, then **open the generated SQL and check for `DROP INDEX` on `Product_name_trgm_idx`, `Product_sku_trgm_idx` or `Brand_name_trgm_idx`** — delete any that appear and carry forward the NOTE block from `20260916183105_add_hot_path_indexes`. Verify by grepping the file for `DROP INDEX` and finding nothing.
- [x] 1.3 Add the data move to that migration's SQL: for each `StoreSetting` row, append an `announcementBar.links` entry whose `href` is exactly `/track-order` to `middleBarLinks` (preserving `label` and `icon`) and remove it from `announcementBar.links`. Guard it so a null `announcementBar`, a missing `links` array, or a `middleBarLinks` that already targets `/track-order` is left untouched. Verify it is re-runnable: running it twice produces the same result as running it once.
- [ ] 1.4 Verify the migration against a copy of real data before it is deployed — a shop with Track Order in its announcement bar ends with it in `middleBarLinks` and its phone/email links intact; a shop without one is unchanged. Report the affected row count.

## 2. Server: validation, default and read path

- [x] 2.1 Add `middleBarLinksSchema` to `store-setting.validation.ts`: an array of `{ icon?: max 100, label: 1–100, href: 1–500 }`, `.max(4)`, with no `source` field. Document why the cap is 4 rather than the announcement bar's 6 (design.md Decision 5). Verify a 5-entry payload is rejected and a 4-entry one accepted.
- [x] 2.2 Register it on the settings update schema as `.optional()` — never `.nullable()`, since there is no third state and an omitted key must mean "leave unchanged" for the partial upsert. Verify a PATCH omitting the key leaves the stored column untouched.
- [x] 2.3 Add the default to `store-setting.constant.ts` carrying the Track Order entry, and include `middleBarLinks` in the settings read so both `GET /settings` and `GET /settings/public` serve it. Verify both endpoints return the field.
- [x] 2.4 Confirm a write to this field fires the existing `store-settings` revalidate tag, as the other header fields do. Verify by tracing the write path, not by assuming.
- [x] 2.5 Add `npx tsx scripts/verify-middle-bar-links.ts` asserting the schema bounds (4 max, label/href required, over-long values rejected) and that a partial PATCH of this key leaves `mainNav` and `announcementBar` untouched. Follow the existing verify-script conventions: import the service directly, prefix any created rows `__verify_`, clean up in a `finally`.

## 3. Storefront: types, service and fallback

- [x] 3.1 Add the `MiddleBarLink` type and the `middleBarLinks` field to `nextjs/src/types/store-settings.ts`, documenting that it is desktop-only and independent of the announcement bar (design.md Decisions 3 and 4). Verify `npx tsc --noEmit` passes.
- [x] 3.2 Map the field in `services/store-settings.ts`, degrading per-field like the rest of that mapper rather than discarding the payload. Verify a settings response missing the key yields the fallback value, not a crash.
- [x] 3.3 Move Track Order in `FALLBACK_SETTINGS`: remove it from `announcementBar.links`, add it to `middleBarLinks` with the same label and icon. Verify the existing `chrome-services.test.ts` still passes and add an assertion that the degraded read serves Track Order in exactly one place (spec: "A degraded settings read").

## 4. Storefront: rendering

- [x] 4.1 In `Header.tsx`, render the links as the first children of the main row's action group (`ml-auto hidden items-center gap-5 md:flex`), before the cart, using the shared `HEADER_ACTION` class and the Iconify `Icon` component for entries that have one. Verify an empty list renders no extra element (spec: "An empty list changes nothing").
- [x] 4.2 Comment the block per the repo's convention: why it is inside the group rather than beside it (inherits `ml-auto`, gap and breakpoint), why a single-line label rather than the built-ins' label-then-value pattern, and that these are desktop-only by inheriting the group's breakpoint. Verify by reading it back against design.md Decision 3.
- [x] 4.3 Verify the links render whether the announcement bar is enabled or disabled (spec: "The announcement bar is off"), and that an entry without an icon renders its label alone with no reserved space.

## 5. Admin: type, limits and editor

- [x] 5.1 Add the `MiddleBarLink` type, a `middleBarLinks: 4` entry to `SETTINGS_LIMITS`, and a `DEFAULT_MIDDLE_BAR_LINKS` mirror to `admin/src/lib/api/store-settings.ts`, each carrying the obligation to stay in step with the backend. Verify the admin type-checks.
- [x] 5.2 Add a "Middle bar links" `EditorSection` to `header-links-page.tsx`, positioned between Announcement bar and Main navigation so the page reads top-to-bottom in storefront order. Use `EditorRow` + `LinkTargetInput` as the announcement links do, with icon, label and target fields and no `source` control. Verify add, reorder and remove all work.
- [x] 5.3 Extend the page's `HeaderDraft` and its `validate()` to cover the new rows — both missing label and missing target reported per row, not the first only, matching the existing behaviour. Verify a row missing both fields reports both.
- [x] 5.4 Add `middleBarLinks` to the page's `mutateAsync` payload, keeping it to exactly three keys. Verify no other settings key is sent (spec: "Saving the header editor leaves other settings alone").
- [x] 5.5 Write the section description to state that this row is desktop-only, so the limitation is visible where the decision is made (design.md Decision 4). Verify the copy says so plainly.
- [x] 5.6 Extend the page's `HeaderPreview` to show these links in its mock main row, or state in a comment why it does not. Verify the preview does not silently omit a row the merchant just configured.

## 6. Cross-checks

- [x] 6.1 Verify the three header lists are independent end to end: edit and save each, reload, and confirm none clobbered the others (spec: "The three header lists stay independent").
- [x] 6.2 Verify Track Order appears in exactly one place after migration — not in both the announcement bar and the main row — on a shop that had it, and that a shop that never had it gets no entry invented.
- [x] 6.3 Run `npm run test --workspace nextjs`, `npm run test --workspace admin`, the admin build (which type-checks), `npm run lint --workspace server`, and the new verify script. Report failures rather than working around them; note any that are pre-existing.
- [ ] 6.4 Manually verify in the running storefront: Track Order renders in the main row beside the cart on desktop, is absent on mobile, survives switching the announcement bar off, and that adding a second link through the admin appears in order.
