## Context

See proposal.md for why. The facts that shape the approach:

- **The pool.** `src/app/lib/tenant.ts` built every client as `new PrismaMariaDb(connectionString)`. The adapter passes that string to `mariadb.createPool`, which reads pool options only under the driver's own names (`connectionLimit`, `minimumIdle`, `idleTimeout`). Its defaults are `connectionLimit: 10` and `minimumIdle = connectionLimit`, so every pool opens and holds 10 connections (`node_modules/mariadb/lib/config/pool-options.js:29,38`). The `?connection_limit=` that `.env.example`, `CPANEL-DEPLOY.md` and `DEPLOY-topitsolution.md` recommend is Prisma's old Rust-engine syntax and is ignored. (Multi-demo hosting, which added a pool per demo database, was removed on 2026-10-05; there is one client, in `src/app/lib/prisma.ts`.)
- **Where the time goes in development.** A developer machine reaches the cPanel MySQL at `topitsolution.com` over the internet, roughly 20 ms per round trip. A signed-in `/api/cart` at about 400 ms is mostly a dozen sequential round trips: session, then user and role, then cart, then campaign pricing. In production, the app and the database share a host and a round trip is sub-millisecond. This change does not try to fix dev-over-WAN latency. It targets what costs time in both places: rows scanned, bytes sent and connections held.
- **The listing query.** `getPublicProducts` runs `count` and `findMany` in parallel through `QueryBuilder`. Both carry `status = 'ACTIVE'`, an optional category/brand/price filter, an `ORDER BY` on one of `createdAt | totalSold | offerPrice | …`, and, when searching, `OR (name LIKE %t% OR description LIKE %t% OR shortDescription LIKE %t%)`. `description` is `@db.Text`. Only single-column indexes exist (`Product.prisma:167-174`), and `offerPrice` has none.
- **What clients read.** In the storefront, `toProduct` (`frontend/src/services/product.ts`) reads only `category.name`, `category.slug` and `brand.name` from a list row. `description` is rendered only by `ProductDetail.tsx`, which is fed by the detail endpoint. Quick view fetches detail too. The admin uses `/products/admin`, which is untouched.
- **Multer errors.** `globalErrorHandler.ts` already turns `MulterError` into a 400 with a friendly message map. No limits are configured today, so `LIMIT_FILE_SIZE` has never fired.

## Goals / Non-Goals

**Goals:**
- Hold no more database connections than the host allows, and no idle connections the host will kill under us.
- Make every public listing an index range scan with no filesort for the default sorts.
- Send fewer bytes per listing and per response.
- Never store an image bigger than the largest size a page renders.

**Non-Goals:**
- **HTTP `Cache-Control` on public GETs.** The storefront already caches every public read in Next's Data Cache with tag invalidation driven by `revalidateStorefront`. An HTTP cache layer (LiteSpeed, a CDN) would not receive those invalidations, so a merchant's save would show stale for up to `s-maxage`. Adding one is a separate decision.
- **In-process caching of `/settings/public` or the category tree.** It is redundant with the Data Cache once the frontend change stops expiring settings every 30 s. A per-process cache would also need its own invalidation on every merchant save.
- **Rewriting related-products scoring.** It scans the ACTIVE catalogue once per product page. That is cheap at this retailer's catalogue size (hundreds to low thousands of rows). The storefront caches the result for the page's lifetime, and pre-filtering would change the deliberate catalogue-wide backfill.
- **Reprocessing existing Cloudinary assets.** The storefront loader already requests resized derivatives of them, so they display correctly.
- **Making local development fast against a remote database.** The fix there is a local MariaDB. It is noted in the deploy docs, not engineered.

## Decisions

### D1. Size the pool explicitly, in code, on the connection string
`src/app/lib/prisma.ts` runs `DATABASE_URL` through `poolConnectionString()` before building the one client. That function sets three driver pool options unless the URL already carries them:

- `connectionLimit`: the URL's legacy `connection_limit` if present, else `DB_POOL_LIMIT`, else **5**.
- `minimumIdle: 1`.
- `idleTimeout: 60` seconds, which stays under shared hosts' typical `wait_timeout`.

The legacy `connection_limit` is translated, not dropped, so an existing URL written with `?connection_limit=N` keeps its intended size.

It edits the string rather than building a config object, so every other URL option keeps the driver's own parsing. This was checked against `mariadb/lib/config/pool-options.js`: `?connectionLimit=5&minimumIdle=1&idleTimeout=60` parses to exactly those values, and `?connection_limit=2` parses to the default 10.

*Why 5:* shared cPanel plans commonly cap `max_user_connections` around 10–25, and a single Node process cannot use more than a handful of connections concurrently anyway.

*Alternative considered:* append `connectionLimit=5` to the URL string. The driver does read it, but it relies on every operator writing the URL right. The docs already got this wrong once, and a default in code cannot be forgotten.

### D2. Composite indexes match filter-then-sort
MySQL can use one index per table access. An index whose leading column is the equality filter (`status`) and whose second column is the sort key serves `WHERE status='ACTIVE' ORDER BY x LIMIT n` as a range scan without a filesort. So the change adds `(status, createdAt)`, `(status, totalSold)`, `(status, offerPrice)` and `(status, isFeatured, createdAt)` for featured listings, plus `(status, categoryId)` and `(status, brandId)` for filtered listings.

The existing single-column `categoryId`/`brandId` indexes stay, because foreign keys need an index led by that column. The single `status` index becomes redundant: every new composite is led by `status`. It is dropped in the same migration.

`ProductImage(productId, isPrimary)` serves the list's primary-image subquery and `(productId, sortOrder)` serves detail's ordered gallery. `Campaign(status, startsAt, endsAt)` serves `getActiveDiscountsForProducts`, which runs on every list and detail read. `Review(productId, status)` serves the approved-reviews query.

*Alternative considered:* FULLTEXT on `name`. It was rejected because MySQL FULLTEXT tokenisation does not match substrings ("buds" would not find "Earbuds") and its minimum-token rules handle Bangla poorly. Substring `LIKE` on a VARCHAR(191) name plus sku is fast enough at this catalogue size once `description` is out of the predicate.

### D3. Search fields are `name` and `sku`, set at the call site
`getPublicProducts` passes `searchableFields: ["name", "sku"]`. `QueryBuilder` is unchanged. The header type-ahead (`searchProducts`, raw SQL with its own weights) is a separate endpoint with its own cap and is out of scope. Case-insensitivity comes from the `utf8mb4_*_ci` collation, as for every other string match in this schema.

### D4. The page-size cap lives in the public query schema
`publicProductQueryZodSchema` gains `limit: z.coerce.number().int().positive().transform(n => Math.min(n, 60)).optional()`. The cap belongs to the public contract, not to `QueryBuilder`. The admin product list legitimately asks for 100 rows, and `QueryBuilder` serves every admin list.

*Why clamp, not 400:* a storefront bug that asks for too much should degrade to a shorter page, not to an error page. `meta.limit` reports the applied value, so a caller can tell. 60 covers the storefront's largest page today (24 on `/deals`, `PAGE_SIZE` on `/products`) with room to spare.

### D5. Narrow projections are a shared constant
`PUBLIC_CATEGORY_REF = { select: { id: true, name: true, slug: true } }` and a matching `PUBLIC_BRAND_REF` replace `category: true` / `brand: true` in both public projections, and inside `categories.include.category` on detail; `tags.include.tag` gets `{ id, name }` because `Tag` has no slug. `PUBLIC_PRODUCT_LIST_SELECT` spreads `PUBLIC_PRODUCT_SCALARS` minus `description`, done by destructuring rather than by a second hand-kept list. That way, a scalar added to the allowlist later reaches both projections, and only `description` is held back from lists.

### D6. Compression at the Express layer
`app.use(compression())` goes before the routers, after CORS. It is applied in Express rather than relying on LiteSpeed/Apache `mod_deflate`, because Passenger-proxied Node responses are not compressed by default on every cPanel host. If the host also compresses, the `Content-Encoding` header already set stops it compressing twice. Backup downloads and CSV exports are streamed binaries or text: compression's default filter skips the former by content type and helps the latter.

### D7. Per-purpose multer instances; Cloudinary transformation on ingest
`multer.config.ts` exports `imageUpload` (10 MB, `image/*`), `mediaUpload` (100 MB, `video/*` on the `video` field and `image/*` on `thumbnail`; multer has one `fileSize` per instance, so the poster's 10 MB ceiling is checked in `uploadVideo` and answered with the same 413), `fileUpload` (10 MB, `image/*` + `application/pdf`) and keeps `backupUpload` with no size limit. Each route picks the one that matches its fields.

A `fileFilter` rejection raises `AppError(415, …)`. `LIMIT_FILE_SIZE` is added to the existing `MULTER_ERROR_MESSAGES` map, and that code maps to **413** instead of the generic 400.

*Why 10 MB / 100 MB:* those are Cloudinary's own free-tier per-file ceilings. A larger file would fail at Cloudinary anyway, only later and with a 500.

In `uploadFileToCloudinary`, when the file is an image (by MIME, which is now passed in) the upload options gain `transformation: [{ width: 2000, height: 2000, crop: "limit", quality: "auto" }]`. That is an incoming transformation: Cloudinary stores the transformed result as the asset. `crop: "limit"` never upscales.

*Alternative considered:* `eager` derivatives at common widths. They were rejected because the storefront loader asks for arbitrary `w_` values from `next/image`'s `deviceSizes`, so pre-generated sizes would rarely be hit. Shrinking the source is what makes every on-demand derivative fast.

## Risks / Trade-offs

- **[Shoppers who searched by a word only in a description stop finding that product]** → The merchant accepted this. Product names in electronics retail carry the model and type. The header type-ahead, which is the main search entry point, is unchanged.
- **[A client somewhere reads `description` or `brand.logo` from a list row]** → Clients were checked: the storefront maps only `category.name/slug` and `brand.name`, and the admin uses `/products/admin`. The Postman collection is updated so the narrowed shape is the documented contract.
- **[The index migration locks `Product` on a busy table]** → InnoDB adds secondary indexes online (`ALGORITHM=INPLACE, LOCK=NONE`) on MariaDB 10.11, and the catalogue is small. Deploy at a quiet hour anyway.
- **[Pool of 5 starves a traffic spike]** → Requests queue in the driver rather than fail, and `DB_POOL_LIMIT` raises it without a deploy of code. The previous behaviour (10 held open) failed outright on hosts with a low connection cap.
- **[Incoming transformation loses detail in a merchant's high-resolution hero art]** → 2000 px covers the largest rendered hero at 1x on a 1920 px screen. A merchant who needs more can raise the constant. It is one number in `cloudinary.config.ts`.
- **[An uploaded image re-encoded at `q_auto` is softer than the original]** → `q_auto` is perceptual-quality-targeted. It is the same quality setting every storefront derivative already uses.

## Migration Plan

1. Deploy server code and run `prisma migrate deploy` (indexes only, additive plus one redundant-index drop).
2. Set `DB_POOL_LIMIT` only if the host needs a value other than 5. Remove `?connection_limit=` from `DATABASE_URL`, which is harmless if left.
3. Update the Postman collection and run `npx tsx scripts/verify-postman-routes.ts`.
4. Rollback: revert the code. The indexes can stay. They only cost write time.

The frontend and admin changes do not depend on step 1 being live. Both tolerate either payload shape.
