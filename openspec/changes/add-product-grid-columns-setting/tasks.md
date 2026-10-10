# Tasks

## 1. Server — accept and publish the column count

- [x] 1.1 In `store-setting.constant.ts`, add `PRODUCT_GRID_COLUMNS = [4, 5, 6] as const` and `productGridColumns: 6` to `DEFAULT_CATALOG_CONFIG`, with a comment on why 6 is the default (today's grid) — verify `npx tsc --noEmit` passes
- [x] 1.2 In `store-setting.validation.ts`, add `productGridColumns` to `catalogConfigSchema` as a closed union of the three literals built from `PRODUCT_GRID_COLUMNS`, required like the other keys; update the schema's doc comment ("All FIVE" → six) — verify with a throwaway `npx tsx -e` parse that 4/5/6 pass and 3, 7, 4.5, `"5"` and a missing key fail
- [x] 1.3 Update the `catalogConfig` doc comment in `prisma/schema/StoreSetting.prisma` to list the new key; run `npm run generate` and verify no migration is produced by `npx prisma migrate diff` against the current schema (doc comments only)
- [x] 1.4 Confirm the service needs no edit: read `store-setting.service.ts`'s public projection and verify the per-key spread over `DEFAULT_PUBLIC_SETTINGS.catalogConfig` returns `productGridColumns: 6` for a row whose stored `catalogConfig` lacks it (check against a live DB with `GET /api/v1/settings/public` after deleting the key from the row)
- [x] 1.5 Update the Postman collection: bring every `catalogConfig` example to the full key set (`showWishlist`, `showCompare`, `showQuickView`, `openCartOnAdd`, `cardQuantityControl`, `productGridColumns`) and add the new field to the settings request descriptions — verify `cd server && npx tsx scripts/verify-postman-routes.ts` passes and a `PATCH /settings` with the example body returns 200

## 2. Admin — the Catalog settings control

- [x] 2.1 In `admin/src/lib/api/store-settings.ts`, add `productGridColumns: 4 | 5 | 6` to `CatalogConfig`, `6` to `DEFAULT_CATALOG_CONFIG`, and an exported `PRODUCT_GRID_COLUMN_OPTIONS` mirroring the server tuple in the same order — verify `npm --prefix admin run build` type-checks
- [x] 2.2 In `catalog-settings-page.tsx`, add a "Products per row on large screens" card with a three-option radio group (4, 5, 6 — default marked) and one line of body copy naming where it applies (homepage product rows, related products) and that phones/tablets are unchanged; it edits the existing draft and saves with the page's existing action — verify in the running admin that choosing 4 marks the page dirty, Save sends `catalogConfig.productGridColumns: 4`, and a reload shows 4
- [x] 2.3 Add or extend the page's Vitest test so that changing the choice and saving submits all six keys with the chosen count — verify `cd admin && npx vitest run src/features/ui/catalog-settings`

## 3. Storefront — read the value and render with it

- [x] 3.1 Add `productGridColumns: 4 | 5 | 6` to `CatalogConfig` in `types/store-settings.ts`, `6` to `FALLBACK_SETTINGS.catalogConfig` in `services/store-settings.ts` and to `FALLBACK_FEATURES` in `lib/catalog-features.ts` — verify `npx tsc --noEmit` in `frontend`
- [x] 3.2 Create `src/lib/product-grid.ts` with `resolveGridColumns`, `PRODUCT_GRID_CLASS` (three literal class strings), `productCardSizes`, `homeRowSize` and `relatedCount` per design.md Decisions 2–5, and apply `resolveGridColumns` where `services/store-settings.ts` repairs `catalogConfig` — verify with a new `src/lib/product-grid.test.ts` covering each count, the coercion of 3/7/`"5"`/undefined to 6, row sizes 12/10/12, related 4/5/6, and that every class string contains its own `lg:grid-cols-N`
- [x] 3.3 Give `ProductCard` an optional `sizes` prop defaulting to today's string — verify `/products` renders its card images with the unchanged `sizes` attribute
- [x] 3.4 Make `ProductSection` and `ProductSectionSkeleton` use `PRODUCT_GRID_CLASS[n]` and pass `productCardSizes(n)` to each card; make `ProductSlider`'s `COLUMNS.lg` and `ProductSliderSkeleton` follow `n`, and rewrite the slider's header comment to point at `lib/product-grid.ts` instead of a hardcoded class string — verify on a ≥1280px viewport at 4, 5 and 6 that grid and slider cards are the same width and the gap is unchanged
- [x] 3.5 In `app/(shop)/page.tsx`, replace the fixed `SECTION_SIZE` with `homeRowSize(n)` for the three product rows (keep Deal of the Week's own size) — verify the homepage grid rows show 12/10/12 products at 6/5/4 with no partial last row on a large screen
- [x] 3.6 In `ProductDetail.tsx`, render the related grid with `PRODUCT_GRID_CLASS[n]`, the first `relatedCount(n)` products and `productCardSizes(n)`; leave `getRelatedProducts(handle, 6)` unchanged — verify a product page at 5 shows one row of five related products
- [x] 3.7 Verify `npm --prefix frontend run test` and `npm --prefix frontend run lint` pass, and that `next build` emits the `lg:grid-cols-4`, `-5` and `-6` utilities (grep the built CSS)

## 4. End-to-end check

- [x] 4.1 With all three apps running, set 4 in the admin, save, and confirm the storefront homepage (grid and slider rows), skeletons and a product page's related products switch to four larger cards across on a large screen after revalidation, while a phone-width viewport stays at two across and `/products`, `/deals` and Deal of the Week are unchanged; then set 6 and confirm the storefront matches its pre-change layout

## Workflow follow-up

- Archive the change once all three apps are deployed (server first, then admin, then storefront).
