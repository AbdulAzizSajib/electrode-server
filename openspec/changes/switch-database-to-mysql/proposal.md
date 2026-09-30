## Why

The platform is leaving Neon/Vercel for cPanel shared hosting, and the target account offers **MariaDB 10.11.19** — not PostgreSQL. Every Postgres-only thing the server currently leans on (the `pg` driver adapter, `pg_trgm` trigram search, `ILIKE`, `FILTER (WHERE …)`, data-modifying CTEs, `unnest`, `pg_database_size`, and Prisma's `mode: "insensitive"`) has no MariaDB equivalent, so the move is not a connection-string swap. This change converts the whole data layer to MySQL/MariaDB in one pass, before any client work assumes the old engine still holds.

## What Changes

- **BREAKING — the database starts empty.** The Prisma provider becomes `mysql`, the 56 existing PostgreSQL migrations are deleted and replaced by a single fresh `init` migration generated for MySQL. Nothing is carried over from Neon; the shop is re-seeded. The Neon project stays alive as a read-only fallback, but it is no longer the source of truth.
- **BREAKING — product search stops tolerating misspellings.** `pg_trgm`'s `similarity()` and the `%` operator have no MariaDB equivalent. Search keeps exact / prefix / substring matching over product name, SKU, description and brand name, with the same weighted ordering, but a typo that trigram similarity used to rescue now returns nothing.
- The driver adapter changes from `@prisma/adapter-pg` to `@prisma/adapter-mariadb`; `pg`, `@types/pg` and `@prisma/adapter-pg` are dropped.
- Every plain `String` field is audited: PostgreSQL maps `String` to unbounded `TEXT`, MySQL maps it to `VARCHAR(191)`. Fields that legitimately hold more (`description`, `metaDescription`, `seoDescription`, `notes`, `message`, `reason`, image/video URLs, `userAgent`, OAuth tokens) get an explicit `@db.Text` or `@db.VarChar(n)` so a save cannot fail with "Data too long for column".
- All 13 `mode: "insensitive"` filters are removed — including the one in `QueryBuilder`, which every list endpoint's search goes through. Case-insensitivity is instead guaranteed by creating the database as `utf8mb4` with a `_ci` collation, which is also what makes Bangla text storable at all.
- Ten files carrying hand-written PostgreSQL SQL are rewritten for MariaDB: the product search query, the stock decrement (`unnest`), the stock mirror rebuild (a data-modifying CTE MariaDB cannot run), two report queries using `FILTER (WHERE …)`, the purchase-order outstanding query, the storage-size query (`pg_database_size`), the backup schema-version read, and three `verify-*` scripts.
- better-auth's Prisma adapter is told `provider: "mysql"`.
- `prisma.config.ts` loses the `DIRECT_DATABASE_URL` split — it existed only to work around Neon's `channel_binding=require`, which a local MariaDB socket does not have.
- `CPANEL-DEPLOY.md`, `.env.example`, `AGENTS.md`, `PRODUCT.md`, `package.json`'s description and the root `CLAUDE.md` are corrected from PostgreSQL to MySQL/MariaDB.

## Capabilities

### New Capabilities

None. No new behavior is introduced; the same API is served from a different engine.

### Modified Capabilities

- `api/catalog`: product search's matching guarantee changes. The spec gains an explicit requirement stating what search matches on and in what order, and records that fuzzy/misspelling tolerance is no longer offered.

## Impact

**Schema** — all 60 files under `prisma/schema/`: the provider in `schema.prisma`, plus a `String` length audit across every model. `@db.Decimal(12,2)`, `@db.Text`, the 41 enums and the 55 `@default(uuid(7))` ids all port unchanged. The 136 `@@index` entries port as-is; the longest generated index name is 47 characters, safely under MySQL's 64-character identifier limit.

**Migrations** — `prisma/migrations/` is emptied and regenerated. The hand-written `20260831000000_add_product_search_indexes` migration (which created the `pg_trgm` extension and three GIN indexes) has no successor.

**Server code** — `src/app/lib/prisma.ts`, `src/app/lib/auth.ts`, `src/app/utils/QueryBuilder.ts`, and the services in `product`, `order`, `stock`, `storage`, `backup`, `purchase-order`, `report`, `attribute`, `brand`, `bundle-deal`, `font`, `seo`, `store-setting`, `tag` and `tax-rule`.

**Scripts** — `scripts/verify-product-search.ts` (its EXPLAIN assertions are Postgres planner-specific and must be replaced), `verify-currency-and-content.ts` and `verify-landing-urgency.ts` (`information_schema` column-name casing), plus `db-latency.mjs`, `migrate-region.mjs` and `repair-migration-checksums.ts`, which import `pg` directly. The other 39 `verify-*` scripts need no edit but must be re-run against MariaDB to prove they still pass.

**Dependencies** — remove `@prisma/adapter-pg`, `pg`, `@types/pg`; add `@prisma/adapter-mariadb`.

**Not affected** — no API route, request shape or response shape changes, so `postman/Ecom.postman_collection.json` needs no edit and `verify-postman-routes.ts` should stay green throughout. `admin/` and `frontend/` need no code change.
