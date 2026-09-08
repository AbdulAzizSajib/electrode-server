## Why

Wishlist, compare, and product quick view are currently unconditional: every storefront built on this platform gets all three, because nothing in the settings record can say otherwise. Plenty of shops do not want them — a single-product store has nothing to compare, a wholesale catalogue has no use for a wishlist, and a merchant selling ten SKUs would rather send a shopper to the full product page than into a preview panel.

Turning any of them off today means editing storefront code, which is exactly the class of change `StoreSetting` exists to eliminate. The storefront already fetches the public settings payload in its root layout on every page, so the flags can ride along at no extra request.

## What Changes

- `StoreSetting` gains a `catalogConfig` JSON column holding three booleans: `showWishlist`, `showCompare`, `showQuickView`.
- A `catalogConfigSchema` in `store-setting.validation.ts` gates every write, in the same way `checkoutConfigSchema` and `themeSchema` already do — Postgres cannot constrain a JSON column's shape, so Zod remains the only gate.
- `catalogConfig` is opted in to the public settings allow-list, so the storefront receives it with the payload it already fetches.
- Defaults are **all three enabled**, and a stored row missing the column merges to that default, so the migration and this change on their own alter no existing shop's behaviour.
- `PATCH /settings` accepts `catalogConfig` as a partial update, independent of the other settings blobs, so the admin's catalog page saves without clobbering checkout or theme.
- The Postman collection gains coverage for the new field on both the admin and public settings requests.

Non-goal, stated because its absence is deliberate: the wishlist and compare **APIs stay live** when a flag is off. Only what the storefront presents is governed here. A merchant who turns wishlist off and later turns it back on finds their shoppers' saved lists intact.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api/site-settings`: adds a requirement that catalog display flags are admin-editable, publicly readable, and default to enabled; the existing public-payload requirement is unchanged and this new field simply joins the allow-list.

## Impact

- `prisma/schema/StoreSetting.prisma` — one additive nullable `Json` column; a new migration under `prisma/migrations/`. No backfill: null merges to the default on read.
- `src/app/module/store-setting/store-setting.validation.ts` — `catalogConfigSchema`, and the field added to `updateStoreSettingZodSchema`.
- `src/app/module/store-setting/store-setting.constant.ts` — `DEFAULT_CATALOG_CONFIG`, and the field on `DEFAULT_PUBLIC_SETTINGS`.
- `src/app/module/store-setting/store-setting.service.ts` — one line in the public projection's allow-list.
- Postman collection — the settings requests, verified by `npm run verify:postman`.
- Consumers: the admin panel's new Catalog Settings page (`admin`) and the storefront (`frontend`) both read this field. Neither can be built until this ships.
