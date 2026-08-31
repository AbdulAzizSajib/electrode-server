## Context

See proposal.md — Why. What matters for the approach is where the current time actually goes, measured against the live database rather than guessed.

**The measurement.** `GET /products?searchTerm=anker`, five products in the catalog, one matching row:

| Step | Cost |
|---|---|
| `count` + `findMany` (already parallel, with `category`/`brand`/`images` joins) | ~1367ms |
| `attachCampaignPricing` — a further `campaignProduct.findMany`, **sequential** after the above | ~154ms |
| **Total database time** | **~1521ms** |

A bare `SELECT 1` on a warm pool costs ~75ms. The database is Neon in `ap-southeast-1` (Singapore), so that is the network floor for one round trip, and every sequential trip adds another. The catalog size is irrelevant here — five rows — and will stay irrelevant to the diagnosis as it grows: the cost is trip count and payload weight.

**Why the listing endpoint cannot simply be made fast.** It is doing what a listing endpoint should: full product records, category and brand objects, images, and campaign pricing that genuinely requires its own query. A suggestion dropdown needs none of that. The fix is not to trim the browse endpoint — that would degrade the results page — but to stop using it for a job it was never shaped for.

**Verified before designing:** `pg_trgm` is available on this database and `similarity('ankar','Anker')` returns 0.33 with the `%` operator matching. A prototype of the query below runs in **~76ms** — one round trip, at the network floor — and correctly resolves "anker", "ankar" (typo), "ANKER" (case), "powercore" (mid-name), and returns empty for nonsense.

## Goals / Non-Goals

**Goals:**
- One database round trip per search, so latency is the network floor rather than a multiple of it.
- Find what shoppers type: brand names, SKUs, and near-misses.
- Rank by relevance, and make the ranking legible enough to tune later.

**Non-Goals:**
- Changing `GET /products` in any way, including its `searchTerm` behaviour.
- A search results *page* payload. This endpoint feeds a dropdown; the listing endpoint already serves the results page.
- Search analytics, synonyms, or per-shopper personalisation.

## Decisions

### A separate endpoint, not a faster `GET /products`

The two jobs want opposite things. A results page wants completeness — category, brand, campaign price, pagination, filters. A dropdown wants one small payload, now. Trying to serve both from one handler means either the dropdown pays for fields it discards, or the results page loses fields it needs.

Splitting also keeps the risk contained: `GET /products` is used by browse, category pages and filters, and this change does not touch it at all.

**Alternative rejected:** a `?light=true` flag on the existing endpoint. It would still run the same pipeline and still need the campaign query skipped conditionally, leaving one handler with two behaviours and two sets of assumptions — the kind of shared path where a later browse fix silently regresses search.

### Raw SQL, not the Prisma query builder

Prisma cannot express what this needs: the trigram operators (`%`, `similarity()`), a computed relevance score, or ordering by that score. Approximating it in Prisma would mean several queries plus in-process sorting — exactly the sequential round trips this change exists to remove.

So the search is one parameterised `$queryRaw`. Every value is interpolated through Prisma's tagged template, which parameterises rather than concatenates, so a search term cannot become SQL.

The cost is that this query is not type-checked against the schema the way Prisma calls are. It is confined to a single function with an explicit result type, and it touches only columns that are stable and central (`Product.name`, `sku`, `description`, `status`, `Brand.name`, `ProductImage`).

### Exact matching first, trigram only as a fallback

Both run in the same query rather than as two round trips: the `WHERE` clause admits exact substring matches *or* trigram matches, and the score orders them. Exact matches score 0.7–1.0, similarity contributes at most 0.4, so an exact match can never be displaced by an approximate one — the spec's "exact matches are preferred" is satisfied by the arithmetic, not by a second query.

Scores are graded so ranking is explainable: exact name 1.0, name prefix 0.9, name substring 0.8, SKU 0.75, brand 0.7, description 0.5, then similarity below all of them. The prototype bears this out — "anker" scores 0.90 as a name prefix, while the typo "ankar" scores 0.12 via similarity alone.

`ORDER BY score DESC, name ASC` — the name tiebreak is what makes repeated identical requests return the same order, which `score` alone would not guarantee.

**Alternative rejected:** Postgres full-text search (`tsvector`). Better for long-form prose, worse here: it matches whole lexemes, so a partial word typed mid-search ("power" before "powercore" is finished) misses, and it does not handle misspellings at all. Autocomplete is a prefix-and-typo problem, which is what trigrams are for.

### Trigram GIN indexes, even at five products

At this size Postgres will sequential-scan regardless and the indexes change nothing measurable. They go in now because the query's shape — `LIKE '%term%'` and `%` similarity — cannot use an ordinary B-tree, so without them this endpoint degrades from "fast" to "scans every product" at exactly the point the catalog gets big enough for it to matter, with no warning signal in between.

### A server-enforced result cap

The response is capped server-side regardless of any client-supplied limit. A dropdown showing more than a handful of suggestions is not useful, and an uncapped `limit` turns a public unauthenticated endpoint into a way to dump the catalog and to make the database do unbounded sorting work per request.

### Route ordering

`GET /products/search` must be registered **before** `GET /products/:slug`. Express matches in declaration order, so the parameterised route would otherwise capture the literal path `search` and attempt a product lookup for a product slugged "search" — a 404 that looks like a missing product rather than a routing mistake.

## Risks / Trade-offs

**Raw SQL is not schema-type-checked** → Confined to one function with an explicit return type, touching only long-lived columns. A rename of `Product.name` or `Brand.name` would break it at runtime rather than at compile time; that is the accepted cost of trigram support, and those columns are the least likely in the schema to be renamed.

**Trigram thresholds are guesses until there is traffic** → `similarity` weights and the `%` operator's default threshold (0.3) are tuned against a five-product catalog. They may admit noise or miss near-misses on a larger, more varied catalog. The scores are constants in one place precisely so they can be retuned without touching the endpoint's contract.

**A public unauthenticated endpoint invites abuse** → The server-side cap bounds per-request work, and the query is a single indexed statement. Request-rate limiting is a reverse-proxy concern and is not addressed here; worth revisiting if search traffic ever looks automated.

**The extension is a database-level change** → `CREATE EXTENSION IF NOT EXISTS pg_trgm` is idempotent and additive; it creates no tables and alters no existing data. It was already run against this database while verifying the approach, so the migration will be a no-op there and will do the real work on any other environment.

## Migration Plan

1. `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
2. GIN trigram indexes on `Product.name`, `Product.sku` and `Brand.name`.

Both are additive and safe to re-run. Prisma's schema language cannot express either, so the migration is hand-written SQL — the same approach the guest-checkout migration in this repo already took.

**Rollback.** Removing the route disables the endpoint with no data change. The indexes and extension can stay (they cost only disk and a little write overhead) or be dropped independently; nothing else in the application reads them.

## Open Questions

- **The result cap's exact value.** 8 is a reasonable dropdown length; the right number depends on how the storefront renders it. Changing it does not affect the specs or the task breakdown.
