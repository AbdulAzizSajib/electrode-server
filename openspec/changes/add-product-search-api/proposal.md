## Why

Search today is a side-effect of the product listing endpoint: `GET /products?searchTerm=anker` runs the full browse pipeline — count, findMany with `category`/`brand`/`images` joins, then a separate campaign-pricing lookup — and returns every field of every match. Measured against the live database that is **~1.5s of database time for a single matching row** out of five products in the catalog.

The size of the catalog is not the cause. The database is in Singapore and a round trip costs ~75ms, so the cost is the number of sequential trips and the weight of what each one drags back — both of which stay just as bad as the catalog grows. A search-as-you-type box firing that per keystroke is unusable.

Search also cannot find what shoppers actually type. `searchTerm` matches only `name`, `description` and `shortDescription`, so a shopper typing a brand ("anker") finds a product only when the brand happens to appear in its name, and a single mistyped letter ("ankar") returns nothing at all — on mobile, where most of this traffic arrives, that is a dead end rather than an edge case.

## What Changes

- **A dedicated suggestion endpoint, `GET /products/search`.** Built for latency: one database round trip, and a deliberately small response — id, name, slug, price, and one image — with no category, brand, or campaign objects. It answers "what should the dropdown show", not "render a product page".
- **Search matches brand name and SKU too**, not just name and description. Typing a brand returns that brand's products; typing a SKU finds the exact item.
- **Typo tolerance.** A term that matches nothing exactly falls back to trigram similarity, so "ankar" still finds "Anker". Postgres `pg_trgm` is verified available on this database and matches that pair at 0.33 similarity.
- **Results ranked by relevance, not recency.** An exact name match outranks a prefix match, which outranks a description match. The existing endpoint sorts by `createdAt`, which for a search is arbitrary.
- **The existing `GET /products?searchTerm=` keeps working unchanged.** It remains the full-detail listing for a search *results page*; this change adds a fast path beside it rather than altering it. **Not breaking.**

## Capabilities

### New Capabilities
<!-- None. Search is already part of the catalog's public browse capability; a separate capability would split requirements that must be read together. -->

### Modified Capabilities
- `api/catalog`: The public browse-and-search requirement gains a dedicated suggestion endpoint with its own latency, matching, and ranking guarantees — brand/SKU matching, typo tolerance, relevance ordering, and a response shaped for autocomplete rather than full product rendering.

## Impact

**Schema (migration required)**
- Enable the `pg_trgm` extension.
- Trigram GIN indexes on the searched text columns (`Product.name`, `Product.sku`, `Brand.name`) so similarity matching does not degrade into a sequential scan as the catalog grows.

**Code**
- `src/app/module/product/product.route.ts` — new public `GET /products/search`. Must be declared **before** `/:slug`, or that route captures the literal path `search`.
- `src/app/module/product/product.service.ts` — a search function that issues one raw query (Prisma's query builder cannot express trigram operators or relevance ranking) and returns the trimmed shape.
- `src/app/module/product/product.controller.ts` and `product.validation.ts` — the endpoint and its query validation.

**Behavior deliberately unchanged**
- `GET /products` in every form, including `?searchTerm=`. Campaign pricing, category-subtree filtering and the existing pagination contract are untouched.

**Out of scope**
- Storefront UI for the suggestion dropdown — this change delivers the API only.
- Search analytics (what shoppers searched for, what returned nothing), which is worth having but is a separate concern.
- Optimizing the existing listing endpoint's own ~1.5s; that is a real problem, but it belongs to the browse path, not to search.
