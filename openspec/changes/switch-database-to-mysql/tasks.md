## 1. Local MariaDB and dependencies

- [x] 1.1 Stand up a local MariaDB 10.11 (Docker or XAMPP) and create an empty database with `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`. Everything through section 8 runs against this, never against the cPanel host.
- [x] 1.2 `npm uninstall @prisma/adapter-pg pg @types/pg` and `npm install @prisma/adapter-mariadb mariadb` in `server/`.
- [x] 1.3 Update `package.json`'s `description` — it still says "Node.js, Express, PostgreSQL, Prisma".
- [x] 1.4 Point `.env` at the local MariaDB: `DATABASE_URL="mysql://user:pass@localhost:3306/dbname"`. Remove `DIRECT_DATABASE_URL`.

## 2. Schema conversion

- [x] 2.1 Set `provider = "mysql"` in `prisma/schema/schema.prisma`.
- [x] 2.2 Audit every `String` field across all 60 schema files. Produce the list of fields that have no `@db.` annotation, and classify each as `@db.Text`, `@db.VarChar(n)`, or "leave as default" per design Decision 6. Record the classification in the change folder so the audit is reviewable, not just applied.
- [x] 2.3 Apply `@db.Text` to the unbounded free-text fields: every `description`, `metaDescription`, `seoDescription`, `notes`, `note`, `message`, `reason`, `successMessage`, `trackingMessage`, plus `Account.accessToken`, `Account.refreshToken`, `Account.idToken` and `Verification.value`.
- [x] 2.4 Apply `@db.VarChar(n)` where a zod schema already states a limit; use `@db.VarChar(512)` for the URL-bearing fields (`image`, `url`, `videoUrl`, `videoThumbnailUrl`, `link`).
- [x] 2.5 Verify no field that is `@unique` or named in an `@@index` was given `@db.Text` — MySQL cannot index a TEXT column without a prefix length. This check must pass before generating any migration.
- [x] 2.6 Remove the `pg_trgm` rationale comments from `Product.prisma` and `Brand.prisma` that point at the deleted GIN indexes, and correct the `Json` column comments in `LandingPage.prisma`, `StoreSetting.prisma`, `Payment.prisma` and `PromoBannerGroup.prisma` that say "Postgres does not constrain a Json column" — the point still stands, the engine name does not.
- [x] 2.7 `npm run generate` and confirm the client builds with no schema validation errors.

## 3. Migration reset

- [x] 3.1 Delete all 56 directories under `prisma/migrations/`. They are PostgreSQL DDL with no MariaDB successor; git history keeps them recoverable.
- [x] 3.2 Generate a single fresh `init` migration against local MariaDB (`npm run migrate`).
- [x] 3.3 Read the generated SQL and confirm: no `CREATE EXTENSION`, no `USING gin`, enums emitted as MySQL `ENUM`, `DATETIME(3)` for `DateTime`, `DECIMAL(12,2)` intact, and every generated index/constraint name under 64 characters.
- [x] 3.4 Confirm the tables inherited `utf8mb4` / `utf8mb4_unicode_ci` from the database default — `SHOW TABLE STATUS` or `information_schema.TABLES.TABLE_COLLATION`.

## 4. Connection and auth wiring

- [x] 4.1 Rewrite `src/app/lib/prisma.ts`: `PrismaPg` → `new PrismaMariaDb(envVars.DATABASE_URL)`.
- [x] 4.2 Change better-auth's Prisma adapter in `src/app/lib/auth.ts` from `provider: "postgresql"` to `provider: "mysql"`.
- [x] 4.3 Strip the `DIRECT_DATABASE_URL` block and its Neon explanation from `prisma.config.ts`, leaving `url: process.env.DATABASE_URL`.
- [x] 4.4 Confirm `src/app/config/env.ts` needs no change (it only reads `DATABASE_URL`), and that nothing else in `src/` references `DIRECT_DATABASE_URL`.
- [x] 4.5 Start the server against local MariaDB and confirm login works end to end — a better-auth session row is written and `checkAuth` accepts the cookie pair.

## 5. Case-insensitive filters

- [x] 5.1 Remove `mode: 'insensitive'` from `src/app/utils/QueryBuilder.ts`. This one covers every list endpoint's search.
- [x] 5.2 Remove the remaining 12 occurrences: `attribute.service.ts` (×2), `brand.service.ts`, `bundle-deal.service.ts`, `font.service.ts` (×2), `seo.service.ts`, `store-setting.service.ts`, `tag.service.ts` (×2), `tax-rule.service.ts`.
- [x] 5.3 Rewrite the `seo.service.ts` comment that contrasts `mode: "insensitive"` with "the pg_trgm indexes product search uses" — both halves are now wrong.
- [x] 5.4 Prove the duplicate-name guards still catch case variants: create a brand `Samsung`, then attempt `samsung`, and confirm the rejection. Repeat for tag, attribute and tax rule.

## 6. Raw SQL rewrites

Use the substitution table in design Decision 7. Leave identifiers unquoted per Decision 3, backticking only MySQL reserved words (`Order` is the one in this schema).

- [x] 6.1 `product.service.ts` — rewrite `searchProducts`: drop the `similarity()` terms and the trigram `%` arm, collapse the two-arm `IN (SELECT … UNION …)` into one `OR` across the existing join, `ILIKE` → `LIKE`, `||` → `CONCAT`, drop the `lower()` wrapping and the `::numeric` / `::"ProductStatus"` casts. Escape `\`, `%` and `_` in the search term before building the pattern.
- [x] 6.2 `product.service.ts` — rewrite the long comment block above the query. It currently explains the trigram operators, the two index-servable arms and the 75ms-per-round-trip rationale; all three are now false. Say what the query does instead and why a scan is acceptable here.
- [x] 6.3 `product.service.ts:1161` — port the second `$queryRaw` (the scored-id query) with the same substitutions.
- [x] 6.4 `order.service.ts:458` — replace the `unnest(...)::text[]/::int[]` stock decrement with a `SELECT ? AS id, ? AS take UNION ALL …` derived table built through `Prisma.join`, keeping it a single statement. Guard the empty-map case.
- [x] 6.5 `stock.service.ts:99` — split the data-modifying CTE into two `UPDATE` statements (ProductVariant mirrors, then Product mirrors). Replace `= ANY(${ids}::text[])` with `IN (${Prisma.join(ids)})` guarded against an empty array, and `NOW()` with `NOW(3)`.
- [x] 6.6 `report.payments.ts` — replace every `agg(x) FILTER (WHERE c)` with `agg(CASE WHEN c THEN x END)` and `COUNT(*) FILTER (WHERE c)` with `COUNT(CASE WHEN c THEN 1 END)`; drop the `::text` casts on enum comparisons in `moneyInSelect` / `moneyOutSelect`.
- [x] 6.7 `report.stock.ts` — `NULL::text` → `CAST(NULL AS CHAR)`, `::int` → `CAST(… AS SIGNED)`, `IS NOT DISTINCT FROM` → `<=>`, `ILIKE` → `LIKE`, drop `NULLS FIRST`, and convert the `FILTER (WHERE …)` aggregates in the totals query.
- [x] 6.8 `report.purchases.ts` and `purchase-order.service.ts` — unquote identifiers in the outstanding-balance queries; no other construct needs changing.
- [x] 6.9 `storage.service.ts` — replace `pg_database_size(current_database())` with the `information_schema.TABLES` sum, and update the comment that explains the `bigint` → `Number` narrowing to say the figure is now an InnoDB estimate.
- [x] 6.10 `backup.service.ts` — unquote `_prisma_migrations` in `getSchemaVersion`.
- [x] 6.11 Re-check the decoded result types at all ten call sites per design Decision 8: booleans arriving as `1`/`0`, `COUNT(*)` BigInt handling, and `DECIMAL` arriving as `Prisma.Decimal` or a string — never a JS float — in `report.payments.ts`, `report.stock.ts` and `purchase-order.service.ts`. Pin the `mariadb` driver's BigInt/decimal options deliberately rather than accepting the default.

## 7. Scripts

- [x] 7.1 Delete `scripts/migrate-region.mjs` (Neon region copy — dead).
- [x] 7.2 Port `scripts/db-latency.mjs` from `pg` to `mariadb`.
- [x] 7.3 Port `scripts/repair-migration-checksums.ts` from `pg` to `mariadb`.
- [x] 7.4 Port the round-trip counters in `scripts/verify-cart.ts` and `scripts/verify-order-placement.ts` from patching `pg.Client.prototype.query` to the `mariadb` driver's connection `query`/`execute`. Keep the existing budgets — retuning them is out of scope (design, Open Questions).
- [x] 7.5 Rewrite `scripts/verify-product-search.ts`: drop the `EXPLAIN` / `SET LOCAL enable_seqscan` assertions and the old-query comparison, and assert instead the scenarios in the catalog spec delta — prefix match, case-insensitive match, Bangla term, misspelling returns empty, draft/archived excluded, empty term short-circuits.
- [x] 7.6 Fix `information_schema` usage in `scripts/verify-currency-and-content.ts` and `scripts/verify-landing-urgency.ts`: `information_schema.COLUMNS`, filter on `table_schema = DATABASE()`, and read back upper-case result keys.
- [x] 7.7 Add `scripts/verify-mysql-charset.ts` — asserts the connected database's charset is `utf8mb4` and its collation ends in `_ci`, and that every table inherited them. Fails loudly, so a wrongly-created database is caught before content is written.
- [x] 7.8 Add `scripts/verify-long-text-fields.ts` — writes a 2,000-character value to each field classified `@db.Text` in task 2.2 and reads it back byte-identical, covering the spec's "long text round-trips intact" scenario.

## 8. Local verification gate

- [x] 8.1 `npm run build` — `prisma generate && tsc && fix-imports` clean, no type errors from the changed raw-query result types.
- [x] 8.2 `npm run lint` clean.
- [x] 8.3 Seed the local database (`utils/seed.ts` for roles, plus the demo seeds) — an empty database makes the verification pass meaningless.
- [x] 8.4 `npx tsx scripts/verify-postman-routes.ts` — must be green; no API contract changed in this work.
- [x] 8.5 Run every `verify-*` script against seeded local MySQL. 58/67 pass; the 9 failures are each diagnosed as pre-existing (stale field names, an unrelated `groupIds` bug, a dead PGlite script, a stale `nextjs/` path, a currency-format assertion, a ledger-vs-mirror fixture) or environmental (storefront not running), not engine-related. Three real porting gaps this pass found were fixed: a `::bigint` cast, BigInt arithmetic in the stock report, and a round-trip counter that silently counted zero.
- [x] 8.6 Manually exercise the paths the raw SQL touches: place a guest COD order (stock decrement + mirrors), run the payments report, run the stock report, open the storage widget, take a backup, and search the catalog in both English and Bangla.

## 9. Documentation

- [x] 9.1 Rewrite `CPANEL-DEPLOY.md` for MySQL: cPanel → **MySQL Databases** instead of PostgreSQL Databases, the `mysql://` URL form, no `sslmode`/`channel_binding`/`DIRECT_DATABASE_URL`, and the `ALTER DATABASE … utf8mb4 utf8mb4_unicode_ci` step placed **before** `migrate deploy` with an explicit warning about what silently breaks if it is skipped. Remove the `pg_dump` / `pg_trgm` sections; state plainly that the new database starts empty and is seeded, not restored.
- [x] 9.2 Update `.env.example`: `DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/DBNAME"`, delete the `DIRECT_DATABASE_URL` entry and its Neon explanation.
- [x] 9.3 Update `server/AGENTS.md` and `server/PRODUCT.md` where they name PostgreSQL or Neon.
- [x] 9.4 Update the root `CLAUDE.md` stack table (`Express 5 + Prisma 7 + PostgreSQL`) and the matching line in the root `PRODUCT.md`.
- [x] 9.5 Correct the PostgreSQL reference in `openspec/specs/api/cart-wishlist/spec.md`.
- [x] 9.6 Swept the whole `server/` tree for `postgres`, `neon`, `pg_`, `ILIKE`, `jsonb`, `adapter-pg` and `PGlite`. Every surviving hit is deliberate — a comment naming PostgreSQL to say what changed. The sweep found three things the task list had missed: two scripts still importing the uninstalled `@prisma/adapter-pg`, ~27 comments asserting the wrong engine, and `verify-middle-bar-migration.ts`, which simulated Postgres with PGlite against a migration file the reset deleted. The first two were fixed; the third was deleted along with the dead `cpanel-init.sql` pg_dump.

## 10. cPanel deploy

- [ ] 10.1 Create the MySQL database and user in cPanel; grant `ALL PRIVILEGES`.
- [ ] 10.2 Run `ALTER DATABASE <db> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` — before any migration, not after.
- [ ] 10.3 Set `DATABASE_URL` in the cPanel app environment; confirm `DIRECT_DATABASE_URL` is absent.
- [ ] 10.4 `npm run migrate:deploy`, then seed.
- [ ] 10.5 Run `verify-mysql-charset.ts` first, then the full `verify-*` pass against the host. Note the host's connection cap and set `connection_limit` in the URL if it is low.
- [ ] 10.6 Point the storefront and admin at the new backend only after 10.5 passes. Leave the Neon project and the Vercel deployment untouched for at least a month as the rollback path.
