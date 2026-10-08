## Why

A brand slot can show the site name **or** the logo, never both. Plenty of shops have a mark that is only a symbol, such as a leaf or an initial, with the name set beside it in type. Today such a shop has two bad choices: a symbol with no name, or the name with no symbol. The only workaround is to bake the name into the logo artwork, which then cannot follow the theme's colours or fonts.

`add-header-footer-brand-display` anticipated this. Its Decision 1 chose an enum over a boolean so that "a third variant (logo and wordmark side by side) would be an added value rather than a second flag" (`enums.prisma`). This change adds that value.

## What Changes

- **New brand display mode, `BOTH`.** A slot set to `BOTH` renders the logo image with the site name beside it. The header and the footer stay independent: each can be `TEXT`, `LOGO` or `BOTH`.
- **The fallback rules carry over unchanged.**
  - The footer borrows the header's artwork when it has none of its own.
  - A `BOTH` slot with no artwork resolves to the wordmark alone, so a slot still never renders empty.
- **The name is announced once.** In `BOTH` the logo is decorative because the visible wordmark already names the shop. Screen readers hear the name once, not twice.
- **Admin.** "Header shows" and "Footer shows" become three buttons: *Site name · Logo · Both*.
  - The logo upload and height fields appear for `Logo` and for `Both`.
  - The page's description of the fallbacks is updated to match.
- **Storefront.** The header, the footer and the landing-page brand (`LandingBrand`) all render the new mode through the shared `resolveBrandSlot`.
- **Database.** The `BrandDisplayMode` enum gains a value, which needs a migration. It is additive: existing rows keep `TEXT` or `LOGO`, and nothing a storefront shows today changes.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `storefront-branding`: a slot's mode may now also be "logo and site name together".
  - The independence requirement changes from "either the wordmark or a logo" to one of three modes.
  - A new requirement covers how the combined mode renders, falls back and is announced.
  - This capability is defined by `add-header-footer-brand-display`, which is complete but not yet archived. **Archive that change before this one**, so that the main `storefront-branding` spec exists for these deltas to modify.

## Impact

- **server:**
  - `prisma/schema/enums.prisma` (`BrandDisplayMode`) and a new migration that alters the two MySQL `ENUM` columns on `StoreSetting`.
  - `store-setting.validation.ts` (two `z.enum`s) and the doc comment on `store-setting.interface.ts` and `StoreSetting.prisma`.
  - `scripts/verify-brand-display.ts`: the resolver matrix and persistence round-trip extended to `BOTH`.
- **nextjs:**
  - `types/store-settings.ts` (`BrandDisplayMode`), `lib/brand-slot.ts` and `lib/brand-slot.test.ts`.
  - `components/layout/Header.tsx`, `components/layout/Footer.tsx` and `components/landing/LandingBrand.tsx`.
- **admin:** `lib/api/store-settings.ts` (`BrandDisplayMode`) and `features/ui/site-settings/site-settings-page.tsx` (`BrandModeField`, the logo-field conditions, the section description).
- **API:** `PATCH /settings` accepts one more enum value; `GET /settings/public` may return it. No other field changes.
- **Deploy order:** run the migration before the server code that accepts `BOTH`. The storefront must deploy alongside or after the server. An older storefront reading `BOTH` falls through its `mode !== "LOGO"` check to the wordmark, so a merchant's logo is hidden, not broken.
