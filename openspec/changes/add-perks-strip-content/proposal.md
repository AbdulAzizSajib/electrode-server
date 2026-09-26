## Why

The home page's perks strip — the coloured band under the product rows reading **Free Shipping / Money Return / Member Discount / Special Gifts** — is the last home-page section whose *content* is still decided by code.

A merchant can already switch it off and drag it anywhere on the page: `PERKS_BAR` has been in `HOME_SECTION_KEYS` since `add-homepage-section-toggles`. What they cannot do is change a single word of it. The four columns are four objects in `frontend/src/data/content.ts` and four `lucide-react` imports in `PerksBar.tsx`, so a shop whose free-delivery threshold is not ৳130, or that does not do 30-day exchanges, is publishing a promise it does not keep — and the only remedy is a developer and a redeploy.

That is worse than cosmetic. Every other band of merchant-facing claims on the site (the announcement bar, the header links, the newsletter's wording, the footer columns) already lives in `StoreSetting`; this one row of four promises is the exception, and it is the one that makes a specific commercial commitment.

## What Changes

- `StoreSetting` gains a nullable `perks` Json column: an **ordered** array of `{ icon, title, description }`, position being the order the band renders its columns in — the same shape and the same reasoning as `homeConfig`.
- `perksSchema` in `store-setting.validation.ts` is the only gate on it, as with every other Json column on this row. It is `.strict()`, requires all three fields on every entry, and caps the list at `MAX_PERKS` (**4**).
- All three fields are **required**. The band is a row of aligned columns: a perk with no icon is a hole in it, and one with no title is a mark floating over a sentence. Removing a perk means removing the row; removing the band means the `PERKS_BAR` switch.
- `icon` is an **Iconify name** (`lucide:truck`), the convention `announcementBar.links` and `middleBarLinks` already use — not an uploaded image. These glyphs are tinted with the band's own foreground colour, so artwork would have to be re-cut every time the merchant changed their brand colour.
- `perks` joins the public settings allow-list, merged with `merge()` so that **null and `[]` stay different**: null is "never configured" and resolves to `DEFAULT_PERKS`; `[]` is a merchant who cleared every column and is served as empty, and the storefront then renders no band.
- `DEFAULT_PERKS` reproduces the four columns the storefront hardcoded, **verbatim** — including "Special Gifts / Contact us anytime", which reads like a mismatched pair because it was one. Correcting the copy here would edit every unconfigured store's home page on deploy rather than on a merchant's decision.
- **No backfill.** The additive migration changes no storefront's rendering on the day it deploys.
- The Postman collection documents `perks` on both the public read and the admin `PATCH /settings` body.

Stated because its absence is deliberate:

- **The band's colour is not here.** `theme.brand` already owns it, and a second place to set it would be two answers to one question.
- **`PERKS_BAR` is not a new section key.** It has existed since `add-homepage-section-toggles` and still governs whether the band renders at all. This column is only what the band *says*, and the two are edited from the same admin row.
- **No icon picker or icon library.** The field takes a name; the storefront resolves it. Shipping a curated icon set would be a second, smaller Iconify that needed maintaining, and the header links editor already made this call.

## Capabilities

### Modified Capabilities

- `api/site-settings`: adds a requirement that the home page's perks strip is admin-editable and publicly readable, bounded in length, all-fields-required per column, with an unconfigured store resolving to the shipped columns and a deliberately emptied one resolving to no band.

## Impact

- `prisma/schema/StoreSetting.prisma` — one additive nullable `Json?` column, with a migration under `prisma/migrations/20260926100000_add_perks_strip_content`. No backfill.
- `src/app/module/store-setting/store-setting.validation.ts` — `MAX_PERKS`, `perksSchema`, and `perks` on `updateStoreSettingZodSchema`.
- `src/app/module/store-setting/store-setting.constant.ts` — `DEFAULT_PERKS`, on both `STOREFRONT_SEED_DEFAULTS` and `DEFAULT_PUBLIC_SETTINGS`.
- `src/app/module/store-setting/store-setting.interface.ts` — `IPerk`, and `perks` on the update payload.
- `src/app/module/store-setting/store-setting.service.ts` — one line in the public projection's allow-list. The update path is untouched: it passes the validated payload straight through.
- `postman/Ecom.postman_collection.json` — both settings requests, verified by `npx tsx scripts/verify-postman-routes.ts`.
- Consumers, shipped alongside: the admin panel edits the columns from the Perks strip row on **UI → Home sections**, and the storefront's `PerksBar` renders them from the settings payload it already holds.
