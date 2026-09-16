## Why

Two pieces of the storefront are still decided by code rather than by the merchant.

**The favicon is a file in the storefront repository.** `frontend/src/app/favicon.ico` is the Next.js icon, and it is the same icon for every deployment of this platform. A merchant who has uploaded their header logo, their footer logo and their organisation logo still cannot change the one mark that appears in a browser tab, a bookmark and a search result — the smallest, most-repeated piece of their branding is the only one that needs a developer and a redeploy. `StoreSetting` already carries every other piece of brand artwork and is already read by the storefront on every page, so there is nowhere else this belongs.

**The newsletter block is welded to the footer.** It renders in `Footer.tsx` above the link columns, on every page of the site, and the only way a merchant can remove it is to clear its heading — an off switch by accident, not by design, and one that leaves the placeholder and button text sitting in the database describing a block that no longer exists. Meanwhile `homeConfig` already expresses exactly this: an ordered list of home-page sections a merchant switches on, off and reorders. The newsletter belongs in that list.

## What Changes

- `StoreSetting` gains a nullable `faviconUrl` column: the URL of the merchant's browser-tab icon, uploaded through the existing `POST /upload/image` route like the two logos already are.
- `faviconUrl` is gated by the same URL validation the logo columns use, and joins the public settings allow-list so the storefront receives it with the payload it already fetches in its root layout.
- The default is **null**, meaning "no favicon configured". Null is not a blank icon — the storefront falls back to the icon it ships with, so the additive migration changes nothing for any existing store.
- `NEWSLETTER` joins `HOME_SECTION_KEYS`, **last, after `BLOG`**, which is where the block renders today relative to everything else on the page. Because the registry is simultaneously the closed key set, the default order and (all-enabled) the default config, a merchant can now switch the newsletter off, switch it back on, and drag it anywhere in the page.
- Existing stored `homeConfig` values need **no backfill**: `reconcileHomeConfig` already splices a registry section missing from a stored list into its registry position, enabled. A shop that saved a configuration before this ships gets the newsletter at the bottom of its home page, switched on.
- **BREAKING for the storefront and the admin panel, not for the API.** After this change the newsletter's presence is governed by `homeConfig`, not by whether `newsletter.heading` happens to be non-empty. The storefront moves the block out of the footer and onto the home page (`frontend`), and the admin moves its copy fields from Footer Links onto Home Sections (`admin`). Both are separate changes in their own repositories and depend on this one.
- The `newsletter` column itself is unchanged: same four fields, same schema, same public projection. Only what decides whether it is shown, and where, moves.
- The Postman collection gains `faviconUrl` on the admin `PATCH /settings` body and on the public settings documentation, and `NEWSLETTER` in the documented `homeConfig` key set.

Stated because its absence is deliberate: **no subscriber endpoint.** The signup form is a no-op today and stays one — there is nowhere to POST an email address and nothing storing subscribers. Moving the block does not make it work, and pretending otherwise would be worse than the honest no-op. Capturing subscribers is its own change.

Also deliberate: **one image, not an icon set.** No separate apple-touch icon, no dark-mode variant, no generated size ladder. A single square image covers the browser tab, which is what a merchant asks for when they ask for a favicon.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api/site-settings`: adds a requirement that the browser-tab icon is admin-editable and publicly readable with a null default; and extends the home-page section requirement so the newsletter signup is one of the sections a merchant can order and switch, arriving in an existing stored configuration without a backfill.

## Impact

- `prisma/schema/StoreSetting.prisma` — one additive nullable `String?` column, with a new migration under `prisma/migrations/`. No backfill.
- `src/app/module/store-setting/store-setting.validation.ts` — `faviconUrl` on `updateStoreSettingZodSchema`.
- `src/app/module/store-setting/store-setting.constant.ts` — `faviconUrl` on `DEFAULT_PUBLIC_SETTINGS`; `NEWSLETTER` appended to `HOME_SECTION_KEYS`, which flows through to `DEFAULT_HOME_CONFIG` on its own.
- `src/app/module/store-setting/store-setting.service.ts` — one line in the public projection's allow-list. `reconcileHomeConfig` is untouched; the new key works because that function already handles it.
- `postman/Ecom.postman_collection.json` — the settings requests, verified by `npx tsx scripts/verify-postman-routes.ts`.
- `scripts/verify-site-settings.ts` — extended with the favicon round-trip and the newsletter reconciliation case.
- Consumers, both blocked until this ships: the admin panel (`admin`, change `add-favicon-and-newsletter-section-admin`) and the storefront (`frontend`, change `add-favicon-and-newsletter-section-ui`).
