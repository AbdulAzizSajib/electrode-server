## Why

The storefront is functionally complete but loads slowly, and an audit traced most of the server-side share of that to five things: a database pool that ignores its configured size, public product listings that scan TEXT columns and sort without composite indexes, list payloads that carry fields no card renders, uncompressed JSON, and image uploads stored as multi-megabyte originals with no size limit. The client storefront and admin panel are addressed by the sibling changes `improve-site-performance-ui` (frontend) and `improve-site-performance-admin` (admin); this change is the server half and ships first, because both clients depend on its behaviour.

## What Changes

- **Database pool is configured explicitly.** The MariaDB adapter is given a parsed pool config (`connectionLimit`, `minimumIdle`, `idleTimeout`) instead of a raw URL whose `connection_limit` parameter the driver silently ignores. Today every pool holds 10 idle connections, which shared cPanel MySQL caps. The deploy docs that recommend `?connection_limit=` are corrected.
- **Composite indexes for the storefront's query shapes**: `Product(status, createdAt)`, `(status, totalSold)`, `(status, isFeatured, createdAt)`, `(status, offerPrice)`, `(status, categoryId)`, `(status, brandId)`; `ProductImage(productId, isPrimary)`, `(productId, sortOrder)`; `Campaign(status, startsAt, endsAt)`; `Review(productId, status)`. One migration, additive only.
- **BREAKING (search results)**: public product listing search (`GET /products?searchTerm=`) matches `name` and `sku` only. It no longer matches `description` or `shortDescription`. Decided with the merchant: a `LIKE '%term%'` over a TEXT column is a full scan that ran twice per request (count and rows).
- **Public list page size is capped.** `GET /products` clamps `limit` to 60; a larger value is served as 60, not rejected.
- **Leaner public list payload**: list rows no longer carry `description`, and the embedded `category` and `brand` are narrowed to `{ id, name, slug }`. Product detail keeps `description`; its `categories[].category` is narrowed the same way and `tags[].tag` to `{ id, name }`.
- **Response compression**: gzip/brotli via the `compression` middleware.
- **Upload limits and normalisation**: multer gets per-route size limits and a MIME filter (images 10 MB, video 100 MB, backup unchanged). Image uploads are resized on ingest to at most 2000×2000 with `quality: auto`, so the stored original is no longer a 6000px phone photo. A rejected file returns 413/415 with a readable message, not a 500.

## Capabilities

### New Capabilities
- `api/media-uploads`: size and type limits on uploaded files, and normalisation of uploaded images before they are stored.

### Modified Capabilities
- `api/catalog`: public listing search fields, the public page-size cap, and the public list/detail payload shape.

## Impact

- **Code**: `src/app/lib/prisma.ts` (pool), `src/app/app.ts` (compression), `src/app/config/multer.config.ts`, `src/app/config/cloudinary.config.ts`, every route that uses `multerUpload`, `src/app/middleware/globalErrorHandler.ts` (multer errors), `src/app/module/product/product.service.ts` and `product.validation.ts`.
- **Schema**: `prisma/schema/Product.prisma`, `ProductImage.prisma`, `Campaign.prisma`, `Review.prisma`, plus one migration. No data change.
- **Dependencies**: adds `compression` (+ `@types/compression`).
- **API contract**: the Postman collection documents the new search fields, the `limit` cap and the narrowed list shape. The storefront already reads only `category.name/slug` and `brand.name` from list rows, and reads `description` only on the detail page, so no client change is required for the payload narrowing.
- **Ops**: `.env.example`, `CPANEL-DEPLOY.md` and `DEPLOY-topitsolution.md` drop `?connection_limit=` and document `DB_POOL_LIMIT`.
- **Not in scope**: HTTP `Cache-Control` on public GETs, an in-process settings cache, and rewriting related-products scoring. See design.md Non-Goals.
