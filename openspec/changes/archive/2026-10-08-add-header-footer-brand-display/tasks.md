## 1. Schema and migration (server)

- [x] 1.1 Add `enum BrandDisplayMode { TEXT LOGO }` to `server/prisma/schema/` (its own file, per the one-model-per-file layout) and verify `npx prisma generate` emits the enum into `generated/prisma/client` — **added to `enums.prisma` instead**: the one-per-file rule is for *models*; every sibling settings enum (`CurrencyPosition`, `SiteMode`, `CourierProvider`) lives in `enums.prisma`
- [x] 1.2 Add four columns to `StoreSetting.prisma` — `headerBrandMode` / `footerBrandMode` (`BrandDisplayMode @default(TEXT)`) and `headerLogoHeight` / `footerLogoHeight` (`Int @default(40)` / `@default(36)`) — and verify `prisma validate` passes
- [x] 1.3 Update the `StoreSetting` model doc-comment: the existing "Two logos, not one" note describes a fallback the storefront never ran, so state that the MODE decides and the artwork only supplies the image; verify by reading it back against design.md Decision 1
- [x] 1.4 Run `pnpm --filter ./server migrate`, then **open the generated SQL, delete the three `DROP INDEX` lines for `Product_name_trgm_idx` / `Product_sku_trgm_idx` / `Brand_name_trgm_idx`, and copy the NOTE block forward from the most recent migration**; verify the committed SQL contains no `DROP INDEX` and the three indexes still exist in the database afterwards
- [x] 1.5 Verify the migration is a pure addition — apply it to a database with an existing settings row and confirm both modes read `TEXT`, both heights read their defaults, and no existing column changed

## 2. Backend module (server)

- [x] 2.1 Add `LOGO_HEIGHT_LIMITS` (min 24, max 96, header default 40, footer default 36) to `store-setting.constant.ts` with a comment stating Zod is the only gate because Postgres cannot express the range; verify it is exported and referenced by the validation schema rather than repeating the numbers
- [x] 2.2 Add the four fields to `DEFAULT_PUBLIC_SETTINGS` in `store-setting.constant.ts` and verify a settings read against an empty table returns both modes as `TEXT` and both heights at their defaults
- [x] 2.3 Add the four keys to `updateStoreSettingsSchema` in `store-setting.validation.ts` — modes as the enum, heights as bounded ints, all `.optional()` and **not** `.nullable()` per the repo convention; verify a height of 23 and one of 97 are both rejected with a readable message and 24/96 are accepted
- [x] 2.4 Add the four fields to `store-setting.interface.ts` (`IUpdateStoreSettingsPayload` and the public result type) and verify `pnpm --filter ./server build` type-checks
- [x] 2.5 Add the four fields to the public projection in `store-setting.service.ts` alongside the existing per-key `merge(...)` calls; verify `GET /settings/public` returns all four and that a row with a null/absent value still comes back at its default rather than `undefined`

## 3. Backend verification scripts (server)

- [x] 3.1 Extend `scripts/verify-site-settings.ts` to cover the four new keys through a partial `PATCH`, asserting that saving them leaves currency, checkout and nav blocks untouched; verify with `npx tsx scripts/verify-site-settings.ts`
- [x] 3.2 Add `scripts/verify-brand-display.ts` covering the mode/fallback matrix at the service layer — header `LOGO` with and without `logoUrl`; footer `LOGO` resolving `footerLogoUrl`, falling back to `logoUrl`, and falling back to text with neither; both `TEXT` with artwork present — creating `__verify_*` data and cleaning up in a `finally`; verify it passes with `npx tsx scripts/verify-brand-display.ts`
- [x] 3.3 Verify the height bounds are enforced at the service layer by asserting out-of-range values are refused and the stored heights are unchanged after the failed call

## 4. Storefront types and service (nextjs)

- [x] 4.1 Add `BrandDisplayMode` and the four fields to `src/types/store-settings.ts`, documenting that the mode alone decides and that a logo mode with no image degrades to the wordmark; verify `pnpm --filter ./nextjs build` type-checks
- [x] 4.2 Add the four fields to `FALLBACK_SETTINGS` in `src/services/store-settings.ts` with values mirroring the backend defaults (`TEXT`, 40, 36) and a comment naming the backend constant they mirror; verify a simulated settings-read failure still renders both slots as the wordmark
- [x] 4.3 Verify the per-field merge in `getStoreSettings` repairs a partial payload — a response missing all four keys must still yield `TEXT` and the default heights, not `undefined`

## 5. Storefront rendering (nextjs)

- [x] 5.1 Add the shared brand-slot resolver (design.md Decision 4) returning text-or-logo for a given slot, applying header → `logoUrl`, footer → `footerLogoUrl ?? logoUrl`, and falling back to text when no URL resolves; verify with a unit test covering all six mode/artwork combinations (`pnpm --filter ./nextjs test`)
- [x] 5.2 Verify the resolver always returns the composed wordmark (`storeName` + `siteNameAccent`) as the logo's `alt`, so both modes announce the shop identically
- [x] 5.3 Render the resolved slot in `src/components/layout/Header.tsx`, keeping the existing home `Link`, its responsive classes and its focus ring; verify the header shows the logo in `LOGO` mode, the wordmark in `TEXT` mode, and the wordmark in `LOGO` mode with no artwork
- [x] 5.4 Render the resolved slot in `src/components/layout/Footer.tsx` in place of the `<h4>` wordmark, wrapping it in a home link so both slots link home; verify the footer resolves its own artwork first, then the header's, then text
- [x] 5.5 Apply the configured height as a reserved box with automatic width in both components; verify no layout shift by loading a page with the image request throttled and confirming the surrounding content does not move once it arrives
- [x] 5.6 Verify a very wide logo at maximum height does not overflow the header row at a 320px viewport — it must scale within its track rather than push the mobile menu and account icons out of place

## 6. Admin (admin)

- [x] 6.1 Add the four fields to the settings type and `StoreSettingsInput` in `src/lib/api/store-settings.ts`, plus a mirrored `LOGO_HEIGHT_LIMITS` and `DEFAULT_BRAND_DISPLAY` constant citing the backend symbols they mirror; verify `pnpm --filter ./admin build` type-checks
- [x] 6.2 Add a per-slot mode selector to the Logos section of `src/features/ui/site-settings/site-settings-page.tsx`, showing which mode each slot is in; verify switching a mode marks the editor dirty and that Reset restores it
- [x] 6.3 Add a bounded height input per slot that clamps to `LOGO_HEIGHT_LIMITS` in the UI; verify an out-of-range value cannot be submitted from the form rather than surfacing a backend 400
- [x] 6.4 Send the four keys from `save()` — modes and heights unconditionally (design.md Decision 5) — and verify the request body contains no key belonging to another settings editor
- [x] 6.5 Correct the Logos section description, which currently documents a fallback that has never run: state that the mode decides, that the footer falls back to the header's artwork, and that a logo mode with no image shows the site name; verify the rendered copy matches the behaviour built in section 5
- [x] 6.6 Verify `markSaved` is called after a successful save so the unsaved-changes bar clears, and that a failed save leaves the draft intact

## 7. End-to-end verification

- [x] 7.1 Verify the merchant's stated case end to end: set header to `LOGO` with artwork and footer to `TEXT`, save, and confirm the storefront renders a logo header above a wordmark footer
- [x] 7.2 Verify the reverse case — text header above a logo footer — and that changing one slot's mode leaves the other's rendering untouched
- [x] 7.3 Verify artwork is retained while a slot shows text: set a slot to `TEXT` with a logo uploaded, save, reload, switch back to `LOGO`, and confirm the same image returns without re-uploading
- [x] 7.4 Verify a store that never opens the branding screen renders exactly as before this change, including one that had already uploaded logos
- [x] 7.5 Verify a branding change reaches the storefront without waiting out the cache window — confirm the backend fires `store-settings` revalidation on save and the storefront serves the new slot on the next request
- [x] 7.6 Run `pnpm --filter ./server lint`, `pnpm --filter ./admin lint`, `pnpm --filter ./nextjs lint` and both test suites, and verify all pass
