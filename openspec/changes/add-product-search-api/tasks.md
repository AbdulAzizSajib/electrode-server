## 1. Database

- [x] 1.1 Hand-write a migration enabling `pg_trgm` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`). Prisma's schema language cannot express an extension, so this follows the hand-written-SQL approach the `add_guest_cod_checkout` migration already used in this repo.
- [x] 1.2 In the same migration, add GIN trigram indexes on `Product.name`, `Product.sku` and `Brand.name` (`USING gin (col gin_trgm_ops)`). Without them the `LIKE '%term%'` and `%` similarity predicates cannot use an index at all, so the endpoint silently degrades to a full scan as the catalog grows.
- [x] 1.3 Apply with `prisma migrate deploy` and confirm `prisma migrate status` reports no drift. Note: `pg_trgm` is already installed on the dev database (it was enabled while verifying the approach), so the extension step is a no-op there — the indexes are the real change.
      → Migration `20260831000000_add_product_search_indexes` applied. Verified: extension installed and all three indexes present (`Product_name_trgm_idx`, `Product_sku_trgm_idx`, `Brand_name_trgm_idx`). `migrate status`: no drift.

## 2. Search implementation

- [x] 2.1 Add `ISearchedProduct` to `product.interface.ts`: `id`, `name`, `slug`, `price`, `image`, `brandName`. Deliberately no category, brand object, or campaign fields — the point of the endpoint is what it leaves out.
- [x] 2.2 Add `searchProducts(term, limit)` to `product.service.ts` as a single `$queryRaw`. Interpolate the term through Prisma's tagged template so it is parameterised, never concatenated into SQL.
- [x] 2.3 Match on product name, SKU, description **and brand name**, case-insensitively, with a trigram (`%`) fallback in the same `WHERE` clause — one round trip, not an exact query followed by a fuzzy one.
- [x] 2.4 Compute a relevance score in the query: exact name 1.0, name prefix 0.9, name substring 0.8, SKU 0.75, brand 0.7, description 0.5, and similarity weighted at most 0.4. The gap is what guarantees an approximate match can never outrank an exact one. Keep the weights as named constants in one place so they can be retuned without touching the endpoint contract.
- [x] 2.5 `ORDER BY score DESC, name ASC` — the name tiebreak is what makes repeated identical requests return a stable order.
- [x] 2.6 Restrict to `status = 'ACTIVE'` and select the primary image via a correlated subquery (`isPrimary DESC, sortOrder ASC LIMIT 1`) so one image comes back per product without a join fan-out.
      → `Product.sku`, `Brand.name` and `Product.description` are all nullable, so every one is `COALESCE`d. An un-coalesced NULL inside `GREATEST` makes the whole score NULL, which would silently drop the row from the ordering.
- [x] 2.7 Cap the result count server-side regardless of any client-supplied limit — this is a public unauthenticated endpoint and an uncapped limit makes it a catalog dump.

## 3. Endpoint

- [x] 3.1 Add `searchProductsZodSchema` to `product.validation.ts`: a required non-empty trimmed `q` (or `searchTerm`), and an optional numeric `limit` clamped to the server cap.
      → Applied in the controller, not via `validateRequest` — that middleware only parses `req.body` and cannot see a GET's query string (same reason `order.controller.ts` parses its idempotency key itself).
- [x] 3.2 Add the controller in `product.controller.ts`, returning the usual `sendResponse` envelope so the shape matches every other endpoint.
- [x] 3.3 Register `GET /products/search` in `product.route.ts` **before** `GET /:slug`. Express matches in declaration order, so a later registration would have `/:slug` capture the literal path `search` and 404 as if a product were missing.
- [x] 3.4 Confirm the route is public — no `checkAuth` — matching the rest of the public catalog.

## 4. Verification

Measure against the live database, not a local guess — the whole change exists because of a measured latency.

- [x] 4.1 `GET /products/search?q=anker` returns the Anker product with only the trimmed fields (no `category`, no `brand` object, no `campaignPrice`).
- [x] 4.2 Time it and record the number. Baseline to beat: ~1500ms of database time on the existing listing endpoint; the prototype of this query ran at ~76ms, which is one round trip to Singapore.
      → **~77ms** (5 runs: 121/77/122/76/77). Old `/products?searchTerm=anker` on the same server: 1459/331/886ms. One round trip to Singapore, matching the prototype.
- [x] 4.3 Brand search: a term matching only a brand name returns that brand's products.
- [x] 4.4 SKU search: a term matching a product's SKU returns that product.
- [x] 4.5 Typo: "ankar" returns the Anker product; and when a term matches both exactly and approximately, the exact match ranks first.
      → Both `ankar` → Anker PowerCore 20000 and `xaomi` → Xiaomi Smart Home Hub. Ranking checked with `pro`, which matches several: the two products with "Pro" in the name rank above the one matching only via description/similarity.
- [x] 4.6 Nonsense term returns an empty list with a success response, not an error and not distant matches.
- [x] 4.7 Case-insensitivity: "ANKER" and "anker" return the same products.
- [x] 4.8 Draft/archived products never appear.
      → JBL Flip 6 temporarily set to ARCHIVED: `q=jbl` returned empty and it dropped out of `q=pro`. **Restored to ACTIVE** and confirmed back in results.
- [x] 4.9 A client asking for a huge `limit` still gets no more than the server cap.
      → `limit=500` returned 3 (all matches, cap 8); `limit=1` returned 1.
- [x] 4.10 Empty or whitespace-only term is rejected as invalid.
      → Empty `q`, whitespace-only `q`, and a missing `q` param all return 400.
- [x] 4.11 Regression: `GET /products?searchTerm=anker` returns exactly what it did before — same fields, same campaign pricing, same pagination meta.
      → Identical: same message, same `meta`, 28 fields per product including `category`, `brand`, `images`, `campaignPrice` and `activeCampaign`.
- [x] 4.12 Route ordering: `GET /products/{a-real-slug}` still resolves the product, proving `/search` did not shadow it.
      → `/products/anker-powercore-20000` resolves the product (200) and `/…/related` still works — `/search` shadows neither.
- [x] 4.13 `npx tsc --noEmit` and `npx eslint src/app/module/product` both clean.
      → Both clean. One lint error surfaced and was fixed (an unused destructured binding when stripping the internal `score` column).

### Bug found by running it

The relevance weights were originally passed as query parameters. Postgres infers an untyped
parameter's type from its context, settled on `integer` inside the `CASE` arms, and rejected
`0.9` outright — `invalid input syntax for type integer`. The prototype had not caught it
because it used SQL literals. Fixed by rendering the weights as `::numeric` literals through a
guarded helper; the search term itself stays parameterised, so nothing user-supplied is inlined.
