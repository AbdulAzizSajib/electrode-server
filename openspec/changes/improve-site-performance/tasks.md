## 1. Database pool (design D1)

- [x] 1.1 In `src/app/lib/tenant.ts` (since folded into `src/app/lib/prisma.ts` when multi-demo hosting was removed), replace `new PrismaMariaDb(connectionString)` in `buildClient` with a parsed pool config: host, port, user, password and database from `new URL()`, with user and password URL-decoded. Add `connectionLimit` from `DB_POOL_LIMIT` (default 5), `minimumIdle: 1` and `idleTimeout: 60`.
- [x] 1.2 Add `DB_POOL_LIMIT` (optional) to `src/app/config/env.ts` and `.env.example`, and remove `?connection_limit=` from `.env.example` and the comment at `tenant.ts:~173` (file since removed).
- [x] 1.3 Correct `CPANEL-DEPLOY.md` and `DEPLOY-topitsolution.md`: drop `?connection_limit=`, document `DB_POOL_LIMIT`, and add one line noting that local development against the remote DB pays about 20 ms per query.
- [x] 1.4 Verify the pool size: start the server, hit a few endpoints, then run `SHOW PROCESSLIST` (or `npm run db:latency`) and confirm at most 5 connections for this user and app.

## 2. Indexes (design D2)

- [x] 2.1 In `prisma/schema/Product.prisma`, add `@@index([status, createdAt])`, `([status, totalSold])`, `([status, offerPrice])`, `([status, isFeatured, createdAt])`, `([status, categoryId])` and `([status, brandId])`, and remove the now-redundant `@@index([status])`.
- [x] 2.2 In `ProductImage.prisma`, add `([productId, isPrimary])` and `([productId, sortOrder])`. In `Campaign.prisma`, add `([status, startsAt, endsAt])`. In `Review.prisma`, add `([productId, status])`.
- [x] 2.3 Run `npm run migrate -- --name improve_site_performance_indexes`, then `npm run generate`, and read the generated SQL to confirm it contains only `CREATE INDEX` / `DROP INDEX`.
- [x] 2.4 Run `EXPLAIN` on the default public listing (`status='ACTIVE' ORDER BY createdAt DESC LIMIT 12`) and confirm it uses `(status, createdAt)` with no `Using filesort`.

## 3. Public catalog contract (design D3–D5, spec `api/catalog`)

- [x] 3.1 In `getPublicProducts`, set `searchableFields: ["name", "sku"]`.
- [x] 3.2 Add the `limit` clamp to `publicProductQueryZodSchema` in `product.validation.ts` (coerce, positive int, `min(n, 60)`), and confirm `meta.limit` reflects the clamped value.
- [x] 3.3 Add `PUBLIC_CATEGORY_REF` / `PUBLIC_BRAND_REF` (`id`, `name`, `slug`), and use them in `PUBLIC_PRODUCT_LIST_SELECT`, `PUBLIC_PRODUCT_DETAIL_SELECT` (`category`, `brand`, `categories.category`) and for `tags.tag` (`id`, `name`, `slug`).
- [x] 3.4 Derive the list scalars as `PUBLIC_PRODUCT_SCALARS` without `description`, so the detail projection keeps it. Update the projection's doc comment.
- [x] 3.5 Fix any TypeScript fallout in the `QueryBuilder` generic and the related/search code that reuses `PUBLIC_PRODUCT_LIST_SELECT`, then run `npm run build`.
- [x] 3.6 Add `scripts/verify-public-catalog-contract.ts`, which checks each `api/catalog` scenario against the live DB:
  - search matches name and SKU but not description-only text
  - `limit=1000` returns at most 60 rows with `meta.limit` 60
  - list rows have no `description` and narrowed category/brand
  - detail still has `description`

## 4. Compression (design D6)

- [x] 4.1 `npm i compression` and `npm i -D @types/compression`.
- [x] 4.2 Add `app.use(compression())` in `src/app/app.ts` after CORS and before the routers, and remove the duplicate `express.urlencoded` registration.
- [x] 4.3 Verify with `curl -H "Accept-Encoding: gzip" -I http://localhost:5000/api/v1/settings/public` that the response shows `Content-Encoding: gzip`.

## 5. Upload limits and normalisation (design D7, spec `api/media-uploads`)

- [x] 5.1 In `src/app/config/multer.config.ts`, export `imageUpload`, `mediaUpload`, `fileUpload` and `backupUpload` with the sizes and MIME filters from D7. Filter rejections throw `AppError(415, …)` naming the accepted types.
- [x] 5.2 Switch each route to its instance:
  - `imageUpload`: auth avatar, banner, brand, category and product images
  - `mediaUpload`: upload `/video`
  - `fileUpload`: upload `/` single file
  - `backupUpload`: backup restore
- [x] 5.3 In `uploadVideo`, refuse a `thumbnail` over 10 MB with a 413 before any Cloudinary call.
- [x] 5.4 In `globalErrorHandler.ts`, add `LIMIT_FILE_SIZE` to `MULTER_ERROR_MESSAGES` (a message naming the limit), map it to 413, and update the map's doc comment.
- [x] 5.5 Change `uploadFileToCloudinary` to accept the file's MIME type. For `image/*`, add the incoming transformation `{ width: 2000, height: 2000, crop: "limit", quality: "auto" }`. Update all 8 call sites to pass `file.mimetype`.
- [x] 5.6 Verify against a dev Cloudinary folder:
  - a 6000×4000 JPEG comes back 2000×1333
  - an 800×800 PNG stays 800×800
  - a 14 MB image returns 413
  - an `.exe` returns 415
  - a video under 100 MB uploads with its poster

## 6. Contract and verification

- [x] 6.1 Update `postman/Ecom.postman_collection.json`:
  - `GET /products` description: search fields, the `limit` cap and the list row shape
  - upload requests: limits and the 413/415 responses
- [ ] 6.2 Run `npx tsx scripts/verify-postman-routes.ts`, `npx tsx scripts/verify-product-search.ts` (header search, which must be unchanged) and `npx tsx scripts/verify-checkout-totals.ts`.
  - 2026-10-05 run against the demo DB:
    - `verify-postman-routes` gives the same output as before the change (the drift it lists is pre-existing)
    - `verify-public-catalog-contract` passes 11/11
    - `verify-product-search` fails 1 check ("a bare % is not a wildcard"), and fails it identically on the pre-change code: a pre-existing header-search bug outside this change
    - `verify-checkout-totals` was **not run**: it rewrites store settings while it runs, the merchant asked that no demo data be put at risk, and checkout pricing is untouched here
  - Left open until the search bug is fixed and checkout totals can be run against a disposable DB.
- [x] 6.3 Run `npm run build` and `npm run lint` clean.
