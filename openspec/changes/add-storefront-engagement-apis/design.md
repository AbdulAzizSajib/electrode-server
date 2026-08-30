## Context

See `proposal.md` — Why. This section records only the existing-code constraints that shape the approach.

- **Stack**: Express + Prisma 7.3 (`prisma-client` generator, output `src/generated/prisma`), PostgreSQL, Zod 4 (top-level `z.email()`/`z.url()` style), TypeScript.
- **Module convention**: every module is a flat folder of `*.controller.ts` / `*.service.ts` / `*.route.ts` / `*.validation.ts` / `*.interface.ts`. Controllers are `catchAsync` + `sendResponse({ httpStatusCode, success, message, data, meta })`. Mutating services take `userId` first solely to feed `AuditLogService.record(userId, action, entity, entityId, { oldData, newData })`. Errors are `throw new AppError(status.X, msg)`.
- **Listing convention**: `QueryBuilder` (`src/app/utils/QueryBuilder.ts`) chains `.search().filter().sort().paginate().where().include().execute()` and returns `{ data, meta: { page, limit, total, totalPages } }`. Note `.where()` deep-merges and does **not** union sibling `OR` arrays — `product.service.ts` works around this by nesting its category clause under a top-level `AND` key.
- **Routing**: `src/app/routes/index.ts` is a flat, manually-ordered list of `router.use` calls mounted at `/api/v1`. Within a module, literal segments are registered before `/:param` catch-alls (`/products/admin` before `/products/:slug`).
- **Auth**: `checkAuth(...roles)` does dual verification (Better Auth session cookie **and** an `accessToken` JWT). `optionalAuth` is the never-throwing variant used by cart. `validateRequest` validates `req.body` only — never params or query.
- **Reviews today**: create (verified-purchase gated), public list, admin list, status update, admin reply. No aggregation anywhere; `PRODUCT_DETAIL_INCLUDE` includes no reviews and no `_count`.
- **Wishlist today**: `getMyWishlist` / `addItem` / `removeItem`, all router-level `checkAuth(...ALL_ROLES)`, unbounded, no product-status filter.
- **StoreSetting today**: singleton keyed on the literal id `"singleton"`, 9 flat scalar fields, admin-only GET/PATCH, **not** audit-logged.
- **Blocking constraint for move-to-cart**: `CartService.addItem` (`cart.service.ts:160`) uses the module-level `prisma` client directly and internally calls `resolveCartId` and `CouponService`. It cannot be enlisted in an externally-supplied `prisma.$transaction` client as written.

## Goals / Non-Goals

**Goals:**

- Keep all four areas inside their existing modules — no new module folders, no new tables.
- Make rating aggregates a denormalized read-optimized field, so no product query pays an aggregation cost.
- Serve a single public settings payload shaped for `Header.tsx` + `Footer.tsx`, cacheable and safe to call on every page render.
- Make related products deterministic and explainable from catalog structure alone.
- Preserve the module conventions above exactly, so the new code is indistinguishable in style from what exists.

**Non-Goals (design-level boundaries beyond the proposal's scope):**

- **No admin-curated related products.** No `RelatedProduct` join table, no manual pinning. Considered and rejected for this change (see Decision 4); re-openable later without breaking the endpoint contract.
- **No collaborative filtering / "bought together"** from `OrderItem` co-occurrence. Requires order volume the store does not yet have.
- **No relational nav/footer tables.** `NavMenu`/`NavMenuItem`/`FooterColumn`/`FooterLink` were considered and rejected (Decision 6).
- **No newsletter subscription backend.** The settings API returns the newsletter *copy* (heading, subtext, button label); actually storing subscribers is a separate capability.
- **No multi-language / multi-currency settings.** `StoreSetting` stays single-currency per its existing schema doc-comment.
- **No review images, helpful-votes, or persisted verified-purchase flag.** Explicitly deselected for this change.
- **No frontend work.** `electrode-nextjs` and `electrode-admin` changes are downstream consumers.

## Decisions

### Decision 1: Denormalize the rating aggregate onto `Product`, recomputed by full re-aggregation

Add `averageRating Decimal @db.Decimal(3,2) @default(0)` and `reviewCount Int @default(0)` to `Product`, plus `@@index([averageRating])`.

On every event that changes the approved set (approve, reject, hide, author edit, author delete, admin delete), run a single `prisma.review.aggregate({ where: { productId, status: APPROVED }, _avg: { rating }, _count: true })` and write both fields back, inside the same `$transaction` as the review mutation.

*Why full re-aggregation over incremental delta arithmetic:* incremental updates (`newAvg = (oldAvg*n ± r)/(n±1)`) accumulate floating-point drift and are wrong whenever a status transition is not the one assumed (e.g. `REJECTED → HIDDEN` must be a no-op, `APPROVED → HIDDEN` a decrement). A re-aggregate is one extra indexed query on `Review(productId, status)` — both columns are already indexed — and is self-healing: any drift corrects itself on the next moderation event. Review moderation is a low-frequency admin action, so the cost is irrelevant.

*Why denormalize at all rather than `_count`/`_avg` in the product include:* Prisma cannot `orderBy` a computed relation aggregate, so "sort by rating" (a spec scenario) is impossible without a stored column. It also keeps the public product list — the hottest query in the app — free of a correlated subquery per row.

*Alternative rejected:* a Postgres materialized view or trigger. Correct, but invisible to Prisma's type generation and to anyone reading the TypeScript, and it would put business logic outside the audit-logged service layer.

### Decision 2: A single `recalculateProductRating(tx, productId)` helper, called from every mutation path

All six call sites (approve/reject/hide via `updateReviewStatus`, author edit, author delete, admin delete) route through one exported-internal helper taking a transaction client. This is the only place the aggregate is written.

*Why:* the spec requires the aggregate never disagree with the readable reviews. Six independent copies of the arithmetic is exactly how that invariant rots. One function, one test surface.

A one-time backfill script recomputes every existing product, since products created before this change have the column default of `0`.

### Decision 3: Rating breakdown computed per-request via `groupBy`, not stored

`GET /products/:id/reviews` gains `meta.ratingBreakdown = { average, total, counts: { 1..5 } }`, computed with `prisma.review.groupBy({ by: ['rating'], where: { productId, status: APPROVED }, _count: true })`, then densified in JS so every rating 1–5 is present with an explicit `0` (a spec scenario).

*Why not store the histogram:* five more columns on `Product` to keep in sync for a value only ever read on the product detail page. `groupBy` on the existing `Review(productId, status)` index is cheap, and the `average`/`total` in the same meta block are read from the already-denormalized `Product` columns rather than recomputed — so the summary bar and the star rating can never disagree.

*Meta shape note:* `sendResponse`'s `IResponseData.meta` is currently typed to the pagination shape only. It needs widening to carry `ratingBreakdown` alongside `page`/`limit`/`total`/`totalPages`. This is an additive type change; no existing response loses a field.

### Decision 4: Related products by weighted SQL scoring, single query, with backfill

`GET /products/:slug/related?limit=` (public, no auth, default limit 6, clamped to a max of 24).

Score, computed in one raw-ish query over `ACTIVE` products excluding the source:

| Signal | Weight |
|---|---|
| Same primary `categoryId` | +3 |
| Same `brandId` | +2 |
| Shares any supplementary `ProductCategory` | +1 |
| `price` within ±40% of the source product's price | +1 |

Order by `score DESC, isFeatured DESC, createdAt DESC`. If fewer than `limit` rows score `> 0`, backfill with `ACTIVE` products ordered by `isFeatured DESC, createdAt DESC`, excluding the source and anything already selected — this satisfies the "isolated product still returns results" scenario.

*Why weighted scoring over a simple category match:* the frontend already does the naive category-match-and-slice ([`products/[handle]/page.tsx`](../../../../electrode-nextjs/src/app/products/[handle]/page.tsx)); reproducing it server-side would be motion without improvement. Scoring answers the user's actual question — on a headphone page, another brand's headphone (category +3, price +1 = 4) correctly outranks the same brand's unrelated charger (brand +2).

*Why ±40% on price:* wide enough to keep a mid-range and a premium headphone related, narrow enough to stop a $15 cable ranking against a $300 pair. It is a tuning constant, defined once as a named constant, not scattered.

*Implementation note:* this is expressible with Prisma's query API only as several `OR`ed queries merged in JS, which loses the ordering guarantee. A single `prisma.$queryRaw` with a `CASE`-sum score column is clearer and one round trip. Raw SQL is already acceptable in this codebase's dependency set; the query takes only the source product's `id`/`categoryId`/`brandId`/`price` and a clamped integer limit as bound parameters, so it carries no injection surface.

*Routing:* `GET /products/:slug/related` is two segments and cannot be shadowed by `GET /products/:slug`. It still gets registered alongside the other public product routes, after the `/admin` literals, per module convention.

### Decision 5: `Json` columns for the settings' structured content, validated by Zod at the boundary

Add to `StoreSetting`: scalars `logoUrl`, `siteNameAccent`, `aboutText`, `copyrightText`; and `Json?` columns `mainNav`, `footerColumns`, `socialLinks`, `announcementBar`, `newsletter`.

Every `Json` column has a Zod schema that is the single source of truth for its shape, applied on `PATCH` before persistence:

- `mainNav`: array of `{ label, href, children?: Array<{ label, href }> }` — the child element type deliberately has **no** `children` key, which is how "nesting is limited to one level" is enforced structurally rather than by a runtime depth check.
- `footerColumns`: array of `{ title, links: Array<{ label, href }> }` — note this changes the frontend's current bare-string links to objects, which is what makes footer links non-dead.
- `socialLinks`: array of `{ platform: z.enum(['facebook','instagram','youtube','x','pinterest']), url: z.url() }` — the enum is exactly the set `SocialIcons.tsx` can render.
- `announcementBar`: `{ enabled: boolean, text: string, links: Array<{ icon, label, href }> }` — `enabled` is separate from content so toggling off preserves the text (a spec scenario).
- `newsletter`: `{ heading, subtext, placeholder, buttonLabel }`.

*Why JSON over relational tables:* see Decision 6.

*Why validate on write, not read:* a malformed nav tree must never reach the database. Reads are then trusted and cheap — important because the storefront reads settings on every page render.

### Decision 6: Rejected — relational nav/footer tables

`NavMenu` / `NavMenuItem` (self-nesting) / `FooterColumn` / `FooterLink` / `SocialLink` would be the textbook-normalized modelling, and would give per-item CRUD and reorder endpoints.

Rejected because: it is ~5 tables and ~10 endpoints to express content that is always read as one whole document and always written as one whole document. Nothing queries "all nav items linking to /deals". It would also multiply the admin-panel work — five CRUD screens with drag-reorder instead of one settings form. The JSON approach keeps the write path a single atomic `PATCH` (no partial-save states where the nav is half-updated) at the cost of losing referential integrity on hrefs — which are free-text URLs anyway, not foreign keys.

*Re-openable:* if per-item permissions or href-to-entity FKs are ever needed, migrating JSON → tables is a contained data migration behind an unchanged public payload shape.

### Decision 7: A public settings projection, not a second settings record

Add `GET /settings/public` (no auth). It reads the same singleton and returns an explicit allow-listed projection — branding, `mainNav`, `footerColumns`, `socialLinks`, `announcementBar`, `newsletter`, `currency`, `currencySymbol`, and the public contact fields. `defaultTaxRatePercent` and `freeShippingThreshold` are excluded.

*Why an allow-list rather than a deny-list:* a field added to `StoreSetting` later must be opted **in** to the public payload. A deny-list leaks by default the day someone adds an API key column.

**Critical:** the existing `getStoreSetting` is a `prisma.upsert` — a *read* that writes. The spec forbids the unauthenticated read from mutating state, so the public path uses `findUnique` with an in-code default fallback, never an upsert. Anonymous traffic must not be able to trigger writes.

*Defaults:* the singleton is seeded (migration + seed script) with values mirroring today's hardcoded frontend content, so the storefront renders identically on first deploy. Additionally, the public read merges stored values over an in-code `DEFAULT_PUBLIC_SETTINGS` object, so a cleared column still yields a usable header/footer rather than a blank one (a spec scenario).

### Decision 8: Wishlist — product-scoped routes, and move-to-cart via a service-layer sequence

Four additions to the existing router, all under the existing `checkAuth(...ALL_ROLES)`:

- `GET /wishlist/count`
- `GET /wishlist/contains/:productId` → `{ inWishlist: boolean, itemId: string | null }` — returns `200` with `false`, never `404`, per spec.
- `DELETE /wishlist/items/product/:productId`
- `POST /wishlist/items/:itemId/move-to-cart`

Route ordering matters: `/items/product/:productId` must be registered **before** `/items/:itemId`, or `product` would be captured as an `itemId`.

`getMyWishlist` gains `page`/`limit` and a `product: { status: ACTIVE }` filter on the item relation; `count` applies the same filter so badge and list agree.

*Move-to-cart atomicity:* as noted in Context, `CartService.addItem` binds the module-level `prisma` and cannot join an external transaction. Rather than refactor the cart service (out of scope, and it is on the checkout critical path), the operation runs **add-to-cart first, then delete the wishlist row**. If the cart add throws, the wishlist entry is untouched — which is exactly the spec's failure scenario ("the wishlist entry remains in place"). The only residual failure is a crash between the two steps, leaving the item in both cart and wishlist: user-visible as a stale wishlist entry, harmless, and self-correcting on the next remove. Full two-phase atomicity would require threading a `tx` client through `CartService`; recorded here as a deliberate trade-off, not an oversight.

*Race-safety on add:* replace the check-then-create with a `try/catch` on Prisma error code `P2002`, rethrown as the intended `409`. The existing compound unique `@@unique([wishlistId, productId])` already makes the DB the arbiter; the current code just fails to catch its violation.

### Decision 9: Author-scoped review routes live under `/reviews/me`, not `/reviews/:id`

`GET /reviews/me`, `PATCH /reviews/me/:id`, `DELETE /reviews/me/:id`.

*Why the `/me` prefix:* `PATCH /reviews/:id` is already taken by admin reply. Overloading one path with two authorization models (admin-replies-to-anyone vs author-edits-own) inside a single handler is how authorization bugs happen. A distinct prefix makes the ownership check unmissable and matches the existing `/customers/me/addresses` convention.

Editing an `APPROVED` review resets `status` to `PENDING` and recalculates the aggregate — content changes must be re-moderated, and an unapproved review must not contribute to the public rating.

Admin hard delete is `DELETE /reviews/:id`, guarded `checkAuth(OWNER, ADMIN)` — deliberately **not** STAFF, who can moderate status but not destroy content, consistent with the existing role gradient.

## Risks / Trade-offs

- **Aggregate drift if a review is ever mutated outside the service layer** (raw SQL, a manual DB edit, a future bulk import) → the recompute helper is idempotent and re-derives from source, so any drift self-corrects on the next moderation event on that product. The backfill script is re-runnable at any time as a repair tool.
- **Move-to-cart is not truly atomic** (Decision 8) → ordered so the failure mode is a harmless duplicate rather than a lost item; the spec's stated failure scenario is satisfied. Revisit if `CartService` is ever refactored to accept a transaction client.
- **JSON settings columns have no DB-level schema** → Zod validation on every write is the only gate, so it must never be bypassed; the service layer must reject unvalidated writes rather than trusting callers. A malformed row written out-of-band would surface as a frontend render error, mitigated by the in-code default merge on read (Decision 7).
- **Related-products raw SQL bypasses Prisma's type generation** → the return is mapped through an explicit interface and the query selects only `Product` columns; a schema rename would break it at runtime, not compile time. Mitigated by keeping the query to a single well-commented location and selecting `id` only, then re-fetching full products through the typed client.
- **Public settings endpoint is unauthenticated and hit on every storefront render** → it is a single indexed `findUnique` on a one-row table with no write path; the frontend is expected to cache it with a `revalidate` window (300s, matching the existing `getCategoryTree()` pattern).
- **±40% price band and the 3/2/1/1 weights are unvalidated guesses** → they are named constants in one file, tunable without touching the endpoint contract or the spec. No data exists yet to tune them against.
- **`Decimal(3,2)` caps `averageRating` at 9.99** → sufficient for a 1–5 scale with two decimals; noted only so a future 10-point scale remembers to widen it.
- **The frontend's footer links change from strings to objects** → a breaking shape change for `Footer.tsx`, but that component must change anyway to consume the API at all. Flagged in the proposal's Impact.

## Migration Plan

Three additive migrations, deployable in one release, in this order:

1. **`add_product_rating_aggregate`** — adds `averageRating`, `reviewCount`, and the `averageRating` index to `Product`. Both columns have defaults, so the migration is non-blocking and existing rows are valid immediately (they read as "0 reviews", which is true until backfilled).
2. **`extend_store_setting_for_storefront`** — adds the branding scalars and the five `Json?` columns to `StoreSetting`. All nullable, no default required.
3. **Seed/backfill script** (idempotent, re-runnable, run once post-deploy):
   - Recompute `averageRating`/`reviewCount` for every product from its `APPROVED` reviews.
   - Upsert the `StoreSetting` singleton's new fields with the defaults mirroring current frontend content, **without** overwriting any non-null value an admin has already set.

**Ordering constraint:** the API can deploy before the backfill runs — products simply report `0` ratings until it does. No endpoint 500s on un-backfilled data.

**Rollback:** the two schema migrations are additive, so rolling back the application code requires no DB rollback — the new columns are simply ignored by the previous version. If the columns must be dropped, do so only after confirming no app instance is still writing them. The wishlist listing's new pagination is the one change with a client-visible contract shift; the frontend is not yet consuming that endpoint, so nothing depends on the old unbounded shape today.
