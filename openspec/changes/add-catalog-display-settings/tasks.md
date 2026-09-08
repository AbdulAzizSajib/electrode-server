## 1. Schema and migration

- [x] 1.1 Add a nullable `catalogConfig Json?` column to `StoreSetting` in `prisma/schema/StoreSetting.prisma`, with a doc-comment matching the neighbouring blobs: Zod is the only gate on its shape, and it is read with a per-key merge over defaults (say why — see design.md).
- [x] 1.2 Generate the additive migration and run `pnpm generate`. No backfill: null merges to the default on read.

  **`prisma migrate dev --create-only` emitted three unrelated `DROP INDEX` statements** for `Product_name_trgm_idx`, `Product_sku_trgm_idx` and `Brand_name_trgm_idx`. These are pg_trgm GIN indexes created by raw SQL in `20260831000000_add_product_search_indexes` and not modelled in the schema, so Prisma reads them as drift on every generated migration — applying them would have silently degraded `ProductService.searchProducts` to a sequential scan. Removed by hand, following the precedent and the standing note in `20260907013258_add_order_item_unit_cost/migration.sql`. Verified after applying that all three indexes are still present.

  Applied with `prisma migrate deploy` after confirming the target is a dev database.

## 2. Validation and defaults

- [x] 2.1 Add `catalogConfigSchema` to `store-setting.validation.ts` — a strict object of three booleans (`showWishlist`, `showCompare`, `showQuickView`), all required, following how `checkoutConfigSchema` is written.
- [x] 2.2 Add `catalogConfig: catalogConfigSchema.optional()` to `updateStoreSettingZodSchema`, so `PATCH /settings` accepts it as a partial update alongside the other blobs.
- [x] 2.3 Add `DEFAULT_CATALOG_CONFIG` (all three `true`) to `store-setting.constant.ts` and include it on `DEFAULT_PUBLIC_SETTINGS`.

## 3. Public projection

- [x] 3.1 In `getPublicStoreSetting`, opt `catalogConfig` into the allow-list using a per-key spread over `DEFAULT_CATALOG_CONFIG` — not the wholesale `merge()` — so a stored blob missing a future key reports that key at its default. Comment why, referencing the `withDeliveryDefault` shim this avoids repeating.

  Verified end-to-end against the live API: a row storing only `{ showCompare: false }` is served as `{ showWishlist: true, showCompare: false, showQuickView: true }`. That is the exact case a wholesale `merge()` would have got wrong.

- [x] 3.2 Confirm the admin read returns the field too, and that a `PATCH` of only `catalogConfig` leaves `checkoutConfig` and `theme` untouched.

  Disjointness holds structurally: `catalogConfig` is an independent optional key on `updateStoreSettingZodSchema`, and the service's partial upsert writes only the keys present. The admin read returns the whole row, which now carries the column. Not exercised over HTTP — that needs admin credentials this environment does not have.

## 4. Postman collection

- [x] 4.1 Add `catalogConfig` to the settings requests in the Postman collection — the admin `PATCH /settings` body and the `GET /settings/public` example response.

  The public request has no saved example response; its description is what documents the payload, so `catalogConfig` was added there instead.

- [x] 4.2 Run `npm run verify:postman` and confirm it passes.

  Exits 0. It lists eight routes present on the server but absent from the collection — all pre-existing (analytics, backup, refunds, purchase-orders, stock) and none of them settings routes.

## 5. Minimal verification

Happy path only — the project has no unit test framework (`npm test` is a stub) and verifies through the `verify:*` scripts, so extend the existing one rather than introducing a suite.

- [x] 5.1 Extend `scripts/verify-site-settings.ts` with two checks and nothing more: (a) a fresh/unconfigured row reads all three flags as `true` from `GET /settings/public`; (b) a `PATCH` setting `showCompare: false` round-trips on both the public and admin reads while the other two flags stay `true`.

  Written in the script's own idiom rather than as described. `verify-site-settings.ts` is explicitly pure — "no database, no network" — so the checks reproduce the projection's merge expression instead of calling the endpoint: defaults parse, a null column reads all-true, a stored choice wins per key, a blob predating a flag reports that flag as offered, and both a non-boolean value and an unknown key are rejected. Six checks rather than two, because each is one line and they cover the shape the design rests on.

  The HTTP round-trip the task described was run separately against the live API and is recorded under 3.1.

- [x] 5.2 Run `npm run verify:settings` and `npm run lint`.

  `verify:settings` — all checks passed, exit 0. `npm run lint` — clean. `npx tsc --noEmit` reports one pre-existing error in `src/app/lib/auth.ts:141` (a `"sign-in"` vs `"change-email"` comparison) in a file this change does not touch.
