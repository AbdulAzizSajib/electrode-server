## 1. Font model and migration (server)

- [x] 1.1 Add `prisma/schema/Font.prisma` with `id`, `family` (`@unique`), `url`, `createdAt`, `updatedAt`, and a `///` doc comment stating that `url` is rebuilt by `parseGoogleFontEmbed` and is never merchant text (design.md Decision 1). Verify `npx prisma validate` passes and `prisma generate` emits the `Font` type into `server/generated/prisma/client`.
- [x] 1.2 Run `pnpm --filter ./server migrate`, then **open the generated SQL, delete the three `DROP INDEX` lines for `Product_name_trgm_idx` / `Product_sku_trgm_idx` / `Brand_name_trgm_idx`, and copy the NOTE block forward from the most recent migration** (CLAUDE.md). Verify by grepping the new migration for `DROP INDEX` and getting no hits, and that the NOTE block is present.
- [x] 1.3 Confirm the trigram indexes survived: query `pg_indexes` for the three index names and verify all three still exist after the migration applies.

## 2. Font module (server)

- [x] 2.1 Create `src/app/module/font/font.interface.ts` with `ICreateFontPayload` / `IUpdateFontPayload` / `IFontResult`. Verify it type-checks under `pnpm --filter ./server build`.
- [x] 2.2 Create `font.validation.ts` — Zod shape only: an `embed` string (1..2000) for create and update. Do **not** re-implement parsing or add any DB-dependent check here (module conventions). Verify the schema rejects an empty string and accepts a 2000-char string.
- [x] 2.3 Create `font.service.ts`: `createFont` calls the existing `parseGoogleFontEmbed` from `../store-setting/google-font` (import it, do not copy or modify it), rejects a duplicate family case-insensitively with `AppError(409)` before insert, and takes `userId` first with an `AuditLogService.record(...)` after the write. Verify a duplicate paste in differing letter case is refused and the DB unique constraint is never reached.
- [x] 2.4 Add `getFonts` (search on `family`, paging, sorting) and `getFontById` to the service. Verify a search for a partial family name returns the expected rows and paging meta.
- [x] 2.5 Add `updateFont` to the service implementing design.md Decision 4: inside one `prisma.$transaction`, re-parse the embed, update the row, and — when `theme.font.family` or `theme.adminFont.family` equals the font's **previous** family — rewrite that selection's `family` and `url` in `StoreSetting.theme`. Verify editing a selected font's embed changes the served `theme.font.url` without re-selecting.
- [x] 2.6 Add `deleteFont` to the service implementing design.md Decision 5: throw `AppError(409)` naming which surfaces hold the font when it matches either selection; delete otherwise. Verify deleting an unused font succeeds and deleting the storefront's font returns 409 with the surface named in the message.
- [x] 2.7 Create `font.controller.ts` (HTTP↔domain only: `catchAsync`, unwrap req, call service, `sendResponse`) and `font.route.ts` with `checkAuth(OWNER, ADMIN)` → `validateRequest(schema)` → handler for writes. Verify no Prisma import appears in either file.
- [x] 2.8 Mount `FontRoutes` at `/fonts` in `src/app/routes/index.ts`, placed so no existing `/:id` parent swallows it, and keep the surrounding ordering comments accurate. Verify `GET /api/v1/fonts` responds and no previously working route regressed.

## 3. Starter font seed (server)

- [x] 3.1 Add the ten starter embed URLs as a constant (Outfit, Inter, Roboto, Poppins, Nunito, Lato, Montserrat, Open Sans, Manrope, **Hind Siliguri** for Bangla). Verify every entry parses cleanly by running each through `parseGoogleFontEmbed` and asserting `ok === true`.
- [x] 3.2 Add `seedFonts()` to `src/app/utils/seed.ts` that runs **only when the `Font` table is empty** (design.md Decision 6, so a merchant-deleted starter font is never reinstated), parses each embed at seed time, and inserts with `createMany({ skipDuplicates: true })`. Call it from `seedSuperAdmin()` alongside `seedStoreSettings()`. Verify: run twice against a DB where a starter font was deleted and confirm it is not restored.
- [x] 3.3 Add `server/scripts/seed-fonts.ts` runnable with `npx tsx`, because `seedSuperAdmin()` never runs on Vercel (`api.ts` does not listen). Verify it populates an empty library and is a no-op on a populated one.

## 4. Theme selection (server)

- [x] 4.1 Add `adminFont` to `DEFAULT_THEME` in `store-setting.constant.ts` (same `{family, url}` shape; default to the current Roboto so the admin's appearance is unchanged) and update the doc comment above it. Verify `DEFAULT_THEME` still validates against `themeSchema`.
- [x] 4.2 In `store-setting.validation.ts`, change `theme.font` to a union of `{ family: string }` (selection) and the existing `fontSchema` string (paste, retained for backwards compatibility per design.md Decision 3), and add `theme.adminFont` with the same union. Keep `themeSchema` `.strict()`. Verify a pasted string still validates exactly as before and `{family:"Inter"}` validates as shape.
- [x] 4.3 In `store-setting.service.ts`, resolve the selection arm inside the settings upsert transaction: look the family up in `Font`, copy `{family,url}` from the row, and throw a 400 for an unknown family. This is a DB read so it must not live in Zod. Verify selecting a nonexistent family is refused and leaves both selections unchanged.
- [x] 4.4 In `store-setting.service.ts`, replace the wholesale `merge(stored?.theme, ...)` for `theme` with a per-key merge plus a nested merge for both `font` and `adminFont` (design.md Decision 2). Verify a stored theme with no `adminFont` key still serves one resolved from the default.
- [x] 4.5 Confirm `revalidateStorefront(STORE_SETTINGS_TAG)` still fires after a font selection change. Verify the storefront serves the new typeface without waiting for its cache window to lapse.

## 5. Server verification scripts

- [x] 5.1 Add `scripts/verify-font-library.ts` importing the service directly (not HTTP), using `__verify_`-prefixed rows cleaned up in a `finally`. Cover: add from `@import` / `<link>` / bare URL; multi-word family stored with a space; non-Google host refused; lookalike `fonts.googleapis.com.evil.test` refused; duplicate family refused case-insensitively. Verify `npx tsx scripts/verify-font-library.ts` passes.
- [x] 5.2 Add `scripts/verify-font-selection.ts` covering: selecting a library font sets `theme.font`; an unknown family is refused; editing a selected font's embed propagates the new URL; deleting a font in use returns 409 naming the surface; reassign-then-delete succeeds; a theme without `adminFont` resolves the default on read. Verify the script passes and cleans up.
- [x] 5.3 Extend `scripts/verify-site-settings.ts` for the new theme shape: assert `DEFAULT_THEME` (including `adminFont`) validates, and that the existing pasted-string assertions still pass unchanged. Verify the script passes.

## 6. Admin API layer

- [x] 6.1 Add `src/lib/api/fonts.ts` following the interfaces → fns → TanStack Query hooks pattern, with keys added to the central `query-keys.ts`. Use `buildListQuery` (which sends `searchTerm`, not `search`). Verify the list hook returns data against a running server.
- [x] 6.2 Add `adminFont` to `Theme`, add the selection shape to `ThemeInput`, and add `adminFont` to the admin's `DEFAULT_THEME` mirror in `src/lib/api/store-settings.ts`, keeping it in step with the server constant. Verify `pnpm --filter ./admin build` type-checks.

## 7. Admin font library screen

- [x] 7.1 Create `src/features/ui/fonts/` list page on `ResourceListPage` with server-side search/paging/sorting, each row previewing its own typeface. Verify search and paging round-trip to the server.
- [x] 7.2 Add the create/edit form as a single component served at both `/new` and `/:id` (antd `ResourceFormPage`, not the RHF variant), with one textarea for the embed and the server's rejection message surfaced on failure. Verify a bad paste shows the server's message and does not reset the form.
- [x] 7.3 Implement the delete flow: on 409, escalate to a reassign dialog that `PATCH /settings` with the replacement then retries the `DELETE` (design.md Decision 5). Verify deleting an in-use font walks through reassignment and then removes the font.
- [x] 7.4 Register `/ui/fonts` in **both** `src/routes/nav-config.ts` (`UI` section) and `src/routes/app-router.tsx` (lazy import + `<Route>`), with the `RoleGuard` and nav `roles` kept in sync by hand. Verify the sidebar entry appears for OWNER/ADMIN and the route renders.

## 8. Admin font pickers

- [x] 8.1 Replace the Font textarea in `src/features/ui/site-settings/site-settings-page.tsx` with two radio-card groups — storefront font and admin panel font — each card previewing its family in its own typeface, each showing the current selection. Drop `fontInput` from the draft. Verify both groups show the saved selections on load.
- [x] 8.2 Have the picker inject a `<link>` per library font while mounted so previews render, torn down on unmount (design.md Decision 8). Verify no `<link>` accumulates across navigations.
- [x] 8.3 Send both selections in the existing `PATCH /settings` payload and call `markSaved` after success, preserving `useSettingsDraft` / `useUnsavedChangesGuard` and the page's existing disjoint key set. Verify the unsaved-changes guard fires on navigate-away and clears after save.

## 9. Admin panel theming

- [x] 9.1 Add `resolveFontStack` / `resolveFontHref` to the admin mirroring `nextjs/src/lib/theme.ts` — re-validate family against the same pattern and require `https:` + exact `fonts.googleapis.com` host + `/css2`|`/css` path, falling back rather than using an unvouched value. Verify a tampered family or non-Google URL yields the fallback stack and a null href.
- [x] 9.2 Delete the hardcoded Roboto `<link>` from `admin/index.html` and reorder `--font-sans` in `src/index.css` so **Roboto stays first in the fallback stack**, keeping the panel's pre-resolution appearance identical to today. Verify the panel looks unchanged with the network blocked.
- [x] 9.3 Add a font provider mounted in `main.tsx` that reads the setting, sets `--font-sans` on `document.documentElement`, and injects/updates one `<link>` keyed by a stable id so repeated changes replace rather than accumulate. Verify changing the admin font updates the panel without a reload and adds no duplicate `<link>`.
- [x] 9.4 Convert `src/lib/antd-theme.ts` to `buildAntdTheme(fontFamily)` and pass `useMemo(() => buildAntdTheme(family), [family])` to `<ConfigProvider>` — antd reads `token.fontFamily` at render, so the CSS variable alone would leave antd forms in the old typeface (design.md Decision 7). Verify an antd form page and a shadcn page render in the same font after a change.

## 10. Storefront

- [x] 10.1 Add `adminFont` to `nextjs/src/types/store-settings.ts` and to `FALLBACK_SETTINGS` + the mapper's per-key font repair in `src/services/store-settings.ts` (carried, not applied). Verify `pnpm --filter ./nextjs build` type-checks and a payload missing `adminFont` is repaired.
- [x] 10.2 Delete the unconditional `@import url("...Outfit...")` on line 1 of `src/app/globals.css`. Verify with devtools that loading a storefront page whose selected font is not Outfit fetches only the selected font's stylesheet.
- [x] 10.3 Confirm `src/lib/theme.ts` and `src/app/layout.tsx` are unmodified and the storefront still applies its font on the first painted frame with no post-load swap. Verify by loading a page and observing no typeface flash.

## 11. Cross-cutting verification

- [x] 11.1 Update the Postman collections for the new `/fonts` endpoints and the `theme.adminFont` key. Verify the settings PATCH example still succeeds.
- [x] 11.2 Update the doc comments this change invalidates — the `theme` shape comment in `StoreSetting.prisma`, the `DEFAULT_THEME` comments in all three packages, and the `Theme`/`ThemeInput` comments in the admin API module — since comments are the spec of record here. Verify no comment still describes the Site Setting page as owning a font paste box.
- [x] 11.3 Run `pnpm build` (server → admin → shop, in that order) and `pnpm --filter ./server lint`. Verify all three build and `scripts/fix-imports.js` runs as part of the server build.
- [x] 11.4 End-to-end check against the specs: add a font, select it for the storefront and a different one for the admin, confirm each surface renders its own; block the font stylesheet and confirm both stay readable; confirm deleting an in-use font is refused and reassignment then allows it.
