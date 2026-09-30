## Context

See [proposal.md](proposal.md) — Why. The constraints that shape everything below:

- **Target is MariaDB 10.11.19**, reported by the cPanel account as `mysql (10.11.19-MariaDB)`. Not MySQL 8. That rules out the `ngram` full-text parser, `utf8mb4_0900_*` collations and a few 8.0-only functions. Everything here uses syntax MariaDB 10.3+ and MySQL 8 both accept, so the work does not have to be redone if the host is ever upgraded.
- **Shared hosting.** Server variables (`innodb_ft_min_token_size`, stopword tables, `lower_case_table_names`, `sql_mode`) cannot be changed, and connection limits are low. No design here may depend on tuning the server.
- **App and database are on the same box.** The per-query round trip drops from ~75ms (Vercel→Neon Singapore) to sub-millisecond. Several existing optimisations exist only to collapse round trips; they stay correct but stop being urgent, which widens what is acceptable in the search rewrite.
- **The database starts empty.** No data migration, no backward compatibility with the PostgreSQL migration history.
- **Bangla is first-class content.** Product names, checkout copy and landing pages are Bangla. Character set is therefore a correctness requirement, not a nicety.

## Goals / Non-Goals

**Goals:**

- A `prisma migrate deploy` against a fresh MariaDB database produces a schema the whole server runs on, with no PostgreSQL leftovers anywhere in `prisma/`, `src/` or `scripts/`.
- Every API response shape stays byte-identical. `verify-postman-routes.ts` stays green from the first commit to the last.
- Every one of the 42 `verify-*` scripts passes against MariaDB, because they are this server's only test suite.
- Where behavior genuinely cannot be preserved, the loss is written down in the spec rather than discovered by a shopper.

**Non-Goals:**

- Moving data out of Neon. Explicitly declined — see proposal.
- Introducing an ORM-level abstraction so both engines work. There is one target engine; a compatibility layer would be cost with no payer.
- Rebuilding typo-tolerant search on top of MariaDB. Discussed under Decisions and rejected for now.
- Changing the backup file format. It is Prisma-level JSON and already engine-neutral.

## Decisions

### 1. `@prisma/adapter-mariadb` with the connection string, not host/port options

The adapter accepts a URL as its first argument: `new PrismaMariaDb(envVars.DATABASE_URL)`. That keeps `src/app/lib/prisma.ts` shaped exactly as it is today and keeps a single `DATABASE_URL` as the only database env var, so `env.ts` needs no new key. The peer driver `mariadb` is a required dependency alongside the adapter.

*Alternative considered:* the options object (`{ host, port, user, password, database }`). Rejected — it would split one env var into five and every deploy doc and `.env.example` would have to teach the split.

`connection_limit` goes in the URL if shared hosting turns out to cap connections; it is not set up front because the right number is the host's, not ours.

**`useTextProtocol: true` is the documented escape hatch** if bound parameters in `LIMIT ?` / `OFFSET ?` misbehave under the binary protocol — two report queries bind their limit and offset. Try the default first.

### 2. `prisma.config.ts` drops the `DIRECT_DATABASE_URL` split entirely

That whole block exists to route migrations around Neon's `channel_binding=require`. A local MariaDB socket has no such parameter. Keeping the fallback would leave a comment explaining a database the project no longer uses, which is worse than no comment. `DIRECT_DATABASE_URL` also comes out of `.env.example`.

### 3. Raw SQL drops double-quoting instead of converting it to backticks

MySQL's default `sql_mode` does not include `ANSI_QUOTES`, so `"Product"` parses as a *string literal*, not an identifier — a silent wrong answer, not an error. The obvious fix is backticks, but backticks inside a JavaScript template literal must be escaped, and every one of these queries is a `Prisma.sql` template. Escaping ~200 identifiers is a large surface for a typo that only shows up at runtime.

**Instead: leave identifiers unquoted.** MySQL accepts unquoted camelCase identifiers; unlike PostgreSQL it does not fold them to lowercase, so `p.offerPrice` resolves correctly without quoting. Backtick only the identifiers that collide with a MySQL reserved word — `Order` is the one that matters here (`ORDER` is reserved), and any column named `key`, `rank`, `groups`, `system`, `lead` or `read` must be checked during the rewrite.

This also sidesteps `lower_case_table_names`: whatever the host sets it to, an unquoted reference resolves the same way the table was created.

### 4. Product search: literal LIKE matching only, no FULLTEXT, no fuzzy arm

The current query does three things MariaDB cannot: `similarity()` (trigram distance), the `%` trigram operator, and GIN indexes over `gin_trgm_ops`. The candidates:

| Option | Verdict |
|---|---|
| `FULLTEXT` + `MATCH … AGAINST` | **Rejected.** InnoDB's `innodb_ft_min_token_size` defaults to 3, the stopword table is server-level, and neither can be changed on shared hosting. A merchant searching a 2-character SKU or a common word would get silently empty results with no way to fix it from inside the app. MariaDB also has no `ngram` parser, so the tokeniser is whitespace-based. |
| `SOUNDEX` | **Rejected.** English-phonetic. Meaningless for Bangla, and it would make search *worse*, not merely less clever. |
| Levenshtein in SQL | **Rejected.** No built-in; a stored function evaluated per row is a full scan with arithmetic on top. |
| **Plain `LIKE` scoring** | **Chosen.** |

The rewritten query keeps the existing weighted `GREATEST(...)` score and the `ORDER BY score DESC, name ASC` tiebreak — only the two `similarity()` terms come out. `ILIKE` becomes plain `LIKE` and the `lower()` wrapping disappears, both because the `_ci` collation (Decision 5) already makes `=` and `LIKE` case-insensitive.

**The two-arm `p.id IN (SELECT … UNION SELECT …)` structure collapses back to one `OR` across the join.** That structure existed purely so each arm could be served by a trigram index. With no trigram indexes, neither arm is index-servable, so the subquery buys nothing and the simpler form is one less thing to keep correct. `LIKE '%term%'` is a table scan either way — acceptable for a single retailer's catalog against a database on the same machine, and the comment in `product.service.ts` must be rewritten to say so rather than leaving its trigram rationale in place.

**Wildcard escaping is fixed while we are here.** The current query interpolates the term straight into `'%' || term || '%'`, so a shopper typing `%` or `_` gets wildcard behavior. The rewrite escapes `\`, `%` and `_` in the term before building the pattern. This is a pre-existing bug, but the rewrite touches exactly that line, so leaving it would be a deliberate choice to ship it again.

### 5. `utf8mb4` + a `_ci` collation is a hard prerequisite, applied before the first migration

Removing 13 `mode: "insensitive"` filters is only safe because MariaDB's comparison semantics are collation-driven. If the database is created with a `_bin` or `_cs` collation, duplicate-name guards on brands, tags, attributes, fonts and tax rules silently stop catching case variants — no error, just duplicates. If it is created as `latin1` (still a common cPanel server default), Bangla text is stored as mojibake and is unrecoverable.

**Corrected during implementation.** This decision was written expecting Prisma's migration SQL to set no per-table charset, leaving tables to inherit the database default. That is wrong: the generated `init` emits

```sql
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

on all 63 tables, and it picks exactly the collation this decision wanted. So the application's own tables are safe whatever the server default is, and the catastrophic `latin1` outcome cannot reach them.

The `ALTER DATABASE` step stays anyway, because three things still follow the database default rather than the tables:

```sql
ALTER DATABASE cpuser_dbname CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

— `_prisma_migrations`, which the migration engine creates rather than the migration; any table added later by hand; and the session's default character set, which decides how a string *literal* inside a raw query is compared against a `utf8mb4` column. It runs **before** `prisma migrate deploy`, never after.

`utf8mb4_unicode_ci` over `utf8mb4_uca1400_ai_ci` (newer, better Unicode, MariaDB 10.10+) for one reason: `utf8mb4_unicode_ci` exists on every MySQL and MariaDB version the project could plausibly land on, and this decision is expensive to get wrong.

Prisma emits no `ENGINE =` clause, so tables use the server default. That is InnoDB on every MySQL 5.5+ and MariaDB, and InnoDB is required here for foreign keys and transactions — `verify-mysql-charset.ts` asserts it rather than assuming it.

A `verify-*` script asserts the live database's charset and collation, so a wrong deploy fails loudly on the first run rather than at the first Bangla product name.

### 6. Every plain `String` is audited before the first migration is generated

PostgreSQL maps Prisma `String` to unbounded `TEXT`; MySQL maps it to `VARCHAR(191)`. This is the single largest source of breakage, and it fails at write time with `Data too long for column`, which is a production error rather than a migration error.

The rule applied per field:

- **`@db.Text`** for anything with no meaningful ceiling: `description` (×10), `metaDescription` (×4), `seoDescription` (×2), `notes`, `note`, `message`, `reason`, `successMessage`, `trackingMessage`, and `Account.accessToken` / `refreshToken` / `idToken` (OAuth ID tokens are JWTs, routinely over 1KB) and `Verification.value`.
- **`@db.VarChar(n)`** where the API's own zod schema already states a limit — the column then matches the contract instead of guessing.
- **Leave as default `VARCHAR(191)`** for ids, slugs, SKUs, phone numbers, colors, enum-ish codes and anything carrying an index or a `@unique`.

The last bullet is load-bearing: a `@db.Text` column **cannot** be indexed in MySQL without a prefix length. Any field that is `@unique` or named in an `@@index` must stay a bounded `VARCHAR`. `Session.token` and `Verification.identifier` are both indexed and both stay bounded; `Account`'s token columns are not indexed and can be `Text`.

URL-bearing fields (`image`, `url`, `videoUrl`, `videoThumbnailUrl`, `link`) get `@db.VarChar(512)` — long enough for any Cloudinary URL, short enough to stay indexable if one ever needs an index.

### 7. PostgreSQL-only SQL constructs and their MariaDB replacements

Ten files carry hand-written SQL. The substitutions, in one place so the rewrite is mechanical rather than inventive:

| PostgreSQL | MariaDB | Site |
|---|---|---|
| `ILIKE` | `LIKE` (collation handles case) | `product.service.ts`, `report.stock.ts` |
| `a \|\| b` | `CONCAT(a, b)` | `product.service.ts` |
| `similarity(a, b)`, `a % b` | *removed* — see Decision 4 | `product.service.ts` |
| `expr::text`, `::int`, `::numeric` | `CAST(expr AS CHAR / SIGNED / DECIMAL)`, or dropped where the cast only existed to satisfy PostgreSQL's type checker | `report.payments.ts`, `report.stock.ts`, `product.service.ts` |
| `'X'::"EnumType"` | plain `'X'` — MySQL enums compare to strings directly | `product.service.ts` |
| `agg(x) FILTER (WHERE cond)` | `agg(CASE WHEN cond THEN x END)`; `COUNT(*) FILTER (WHERE c)` → `COUNT(CASE WHEN c THEN 1 END)` | `report.payments.ts`, `report.stock.ts` |
| `a IS NOT DISTINCT FROM b` | `a <=> b` (NULL-safe equal) | `report.stock.ts` |
| `ORDER BY x ASC NULLS FIRST` | `ORDER BY x ASC` — MariaDB already sorts NULLs first ascending | `report.stock.ts` |
| `x = ANY(${arr}::text[])` | `x IN (${Prisma.join(arr)})`, guarded against an empty array | `stock.service.ts` |
| `unnest(${ids}::text[], ${qtys}::int[]) AS t(id, take)` | a `SELECT ? AS id, ? AS take UNION ALL …` derived table, built with `Prisma.join` | `order.service.ts` |
| `WITH x AS (UPDATE …) UPDATE …` | two separate `UPDATE` statements — MariaDB has no data-modifying CTEs. Already inside `tx`, so atomicity is unchanged | `stock.service.ts` |
| `NOW()` | `NOW(3)` — Prisma's `DateTime` is `DATETIME(3)`; bare `NOW()` truncates to the second | `stock.service.ts` |
| `pg_database_size(current_database())` | `SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.TABLES WHERE table_schema = DATABASE()` | `storage.service.ts` |
| `"_prisma_migrations"` | `_prisma_migrations` (table exists under the same name) | `backup.service.ts` |
| `information_schema.columns` / `column_name` | `information_schema.COLUMNS`, filtered by `table_schema = DATABASE()`; result keys come back upper-case | `verify-currency-and-content.ts`, `verify-landing-urgency.ts` |

The `unnest` replacement keeps the single-statement bulk decrement rather than falling back to a loop of updates. One statement was the point of that code, and a `UNION ALL` derived table preserves it.

### 8. Raw-query result types change, and every call site is re-checked

This is the trap that will not announce itself. The `pg` driver and the `mariadb` driver decode SQL types differently:

- **Booleans.** PostgreSQL has a real `boolean`; MySQL returns `TINYINT(1)`, so a raw query's boolean column arrives as `1`/`0`, not `true`/`false`. `report.payments.ts` selects `isSettled` this way. `if (row.isSettled)` still works; `row.isSettled === true` silently does not.
- **`COUNT(*)`.** Returns `bigint` under `pg`. The `mariadb` driver's BigInt handling is configurable and must be pinned deliberately, because `storage.service.ts` already does `Number(bytes)` and the report totals are typed `bigint`.
- **`DECIMAL`.** `pg` hands PostgreSQL `NUMERIC` to Prisma as `Prisma.Decimal`. The `mariadb` driver may return a string or a JS number depending on configuration — and a JS number is exactly the wrong representation for money.

So the rewrite is not finished when the SQL parses. Each of the ten call sites has its returned row types re-asserted, and the money-carrying ones (`report.payments.ts`, `report.stock.ts`, `purchase-order.service.ts`) get an explicit check that amounts still arrive as `Prisma.Decimal` or a string, never a float.

### 9. Migration history is reset to a single `init`

The 56 existing migrations are PostgreSQL DDL — `CREATE EXTENSION`, `USING gin`, PostgreSQL enum types. None can run on MariaDB, and there is no data to preserve their history for. They are deleted and one `init` migration is generated from the converted schema.

`20260831000000_add_product_search_indexes` is the only one worth naming: it created `pg_trgm` and three GIN indexes and has no successor, by Decision 4.

`backup.service.ts` reads the newest applied migration name as its `schemaVersion`, which means **a backup taken from the old PostgreSQL database can never be restored into the new MariaDB one** — the version will not match. Since no data is being carried over, that is the correct behavior, not a bug to work around.

### 10. Scripts importing `pg` are ported or deleted, deliberately

- `migrate-region.mjs` — **deleted.** It copies a Neon database between regions. Dead the moment Neon is.
- `db-latency.mjs` — **ported** to `mariadb`. A latency check is more useful on shared hosting, not less.
- `repair-migration-checksums.ts` — **ported.** Checksum drift is not Neon-specific.
- `verify-cart.ts`, `verify-order-placement.ts` — **ported.** These monkey-patch `pg.Client.prototype.query` to count round trips per request, which is the assertion they exist to make. The equivalent hook is the `mariadb` driver's connection `query`/`execute`. Their round-trip *budgets* should be re-read after the move: the numbers were chosen against a 75ms remote hop and may deserve revisiting, but that is a separate change — this one only keeps the counter working.
- `verify-product-search.ts` — **rewritten.** Its core is a comparison against the old query plus `EXPLAIN` assertions that force `enable_seqscan = off`; both are PostgreSQL planner internals. The result-equivalence half is replaced by assertions against the behavior the spec now states, and the plan half is dropped rather than translated — there is no index left to prove use of.

## Risks / Trade-offs

**The database is created with the server's default charset and nobody notices** → *Downgraded during implementation.* Prisma stamps `utf8mb4` / `utf8mb4_unicode_ci` onto every table it creates (Decision 5), so Bangla content and the case-insensitive duplicate guards are safe on the application's own tables even if the database default is `latin1`. What remains is narrower: `_prisma_migrations`, hand-added tables, and the session default that governs how a raw query's string literals compare. Still mitigated the same way — the `ALTER DATABASE` step ordered before `migrate deploy` in `CPANEL-DEPLOY.md`, and `verify-mysql-charset.ts` reading the live values back.

**A `VARCHAR(191)` is missed in the audit** → the merchant hits `Data too long for column` in production, on a save, with real copy in the form. Mitigated by driving the audit from the schema files rather than from memory (every `String` without a `@db.` annotation is on the list until it is ruled out), and by a script that writes a long value to each `Text`-designated field and reads it back.

**Search quietly gets worse for shoppers who cannot spell** → real lost sales on a COD-first storefront where search is the main discovery path. Not mitigated; accepted, recorded in the spec, and the reason the decision table above is written out rather than assumed. If it proves costly, the honest fix is an external search index, not a MariaDB trick.

**A raw query parses but decodes to the wrong JS type** → money arrives as a float, or `=== true` silently never matches. Mitigated by Decision 8's per-call-site re-check, and by the report `verify-*` scripts, which already assert totals.

**Storage size becomes an estimate** → the admin storage widget reports InnoDB's `information_schema` statistics, which lag reality and can be off by a noticeable margin, where `pg_database_size` was exact. Accepted; the widget is advisory. Worth a wording change in the admin UI only if it starts confusing the merchant.

**Shared hosting caps concurrent connections lower than Vercel did** → `Too many connections` under modest load. Mitigated by setting `connection_limit` in the URL once the host's actual cap is known, and by the fact that the app is now a single long-lived process rather than a fleet of serverless functions each holding a pool.

**The 39 untouched `verify-*` scripts pass for the wrong reason** → they run against an empty database and assert nothing. Mitigated by seeding before the verification pass and by treating "passed on an empty shop" as a failed verification.

## Migration Plan

1. Convert the schema and regenerate the client locally against a **local MariaDB 10.11** (Docker or XAMPP), not against the cPanel host. Nothing touches the host until the schema is proven.
2. Port the raw SQL and the scripts. `verify-postman-routes.ts` is static and must stay green throughout — it is the cheapest signal that no API contract drifted.
3. Seed, then run all 42 `verify-*` scripts against local MariaDB. This is the gate; the server has no other test suite.
4. On cPanel: create the database and user, grant `ALL PRIVILEGES`, then `ALTER DATABASE … utf8mb4 utf8mb4_unicode_ci` **before** anything else.
5. `prisma migrate deploy`, seed, run the verification pass again against the host.
6. Point the deployed storefront and admin at the new backend only after step 5 passes.

**Rollback:** the Neon database and the current Vercel deployment stay live and untouched for at least a month (`CPANEL-DEPLOY.md` already says so). Rolling back is repointing DNS and the clients' API base URL; nothing in this change writes to Neon, so there is nothing to undo there. The `server` git repository keeps the PostgreSQL migrations in history, so the old schema is recoverable by checkout even though it is deleted from `main`.

## Open Questions

- The exact `connection_limit` for the cPanel MySQL account. Cannot be answered before the host reports its cap; it is a URL parameter, so it changes nothing in this design.
- Whether `verify-cart.ts` and `verify-order-placement.ts` should keep their current round-trip budgets now that a round trip is ~100× cheaper. Deliberately deferred — this change keeps the counters working and the budgets as they are; retuning them is its own change with its own evidence.
