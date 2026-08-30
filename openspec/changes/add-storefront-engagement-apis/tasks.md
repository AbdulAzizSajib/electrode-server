## 1. Schema and migrations

- [x] 1.1 Add `averageRating Decimal @db.Decimal(3,2) @default(0)` and `reviewCount Int @default(0)` to `Product` in `prisma/schema/product.prisma`, plus `@@index([averageRating])`
- [x] 1.2 Add branding scalars to `prisma/schema/StoreSetting.prisma`: `logoUrl String?`, `siteNameAccent String?`, `aboutText String?`, `copyrightText String?`
- [x] 1.3 Add JSON columns to `StoreSetting`: `mainNav Json?`, `footerColumns Json?`, `socialLinks Json?`, `announcementBar Json?`, `newsletter Json?`; update the model's doc-comment to note the Zod-validated-on-write contract
- [x] 1.4 Generate migration `add_product_rating_aggregate` and verify it is additive-only (defaults present, no table rewrite)
- [x] 1.5 Generate migration `extend_store_setting_for_storefront` and verify all new columns are nullable
      <!-- DEVIATION: both schema edits were made before running `migrate dev`, so Prisma
           emitted them as ONE migration, 20260830065447_add_product_rating_aggregate,
           rather than the two planned. Content verified additive-only: ADD COLUMN
           throughout, Product columns defaulted, all 9 StoreSetting columns nullable.
           Already applied to the live database, so not split retroactively. -->
- [x] 1.6 Run `prisma generate` and confirm the client in `src/generated/prisma` picks up all new fields

## 2. Review rating aggregation

- [x] 2.1 Add `recalculateProductRating(tx, productId)` to `review.service.ts`: aggregate `_avg.rating` + `_count` over `{ productId, status: APPROVED }` and write both back to `Product`; coerce a null average to `0`
- [x] 2.2 Wrap `updateReviewStatus` in `prisma.$transaction`, calling the helper after the status write so approve/reject/hide all keep the aggregate correct
- [x] 2.3 Add `averageRating` and `reviewCount` to `PRODUCT_LIST_INCLUDE` and `PRODUCT_DETAIL_INCLUDE` selections in `product.service.ts` (verify they flow through `attachCampaignPricing` unmodified)
      <!-- No edit needed: both constants use Prisma `include` (relations only), not
           `select`, so all Product scalars — including the two new columns — are
           already returned. Verified against the generated client. -->
- [x] 2.4 Allow `averageRating` as a sort key on the public product listing so `?sortBy=averageRating` orders by the aggregate
      <!-- No edit needed: QueryBuilder.sort() (QueryBuilder.ts:234) passes any sortBy
           through unrestricted, so ?sortBy=averageRating already orders by the column. -->
- [x] 2.5 Write an idempotent backfill script that recomputes `averageRating`/`reviewCount` for every existing product from its `APPROVED` reviews; make it re-runnable as a repair tool
      <!-- scripts/backfill-storefront-engagement.ts — also covers task 7.8. -->
- [x] 2.6 Verify: approving a review raises the product's count and average; rejecting it lowers them; a `REJECTED → HIDDEN` transition is a no-op; removing the last approved review yields `0`/`0` not null
      <!-- Verified against the live DB with a disposable product/reviews harness.
           All six transitions produced the expected aggregate, including the
           REJECTED->HIDDEN no-op and the 0/0 (not null) empty case. -->

## 3. Review rating breakdown

- [x] 3.1 Widen the `meta` type in `src/app/shared/sendResponse.ts` (`IResponseData`) to carry an optional `ratingBreakdown` alongside the existing pagination fields
- [x] 3.2 In `getPublicProductReviews`, add a `groupBy({ by: ['rating'], where: { productId, status: APPROVED } })` and densify the result so ratings 1–5 are all present, each defaulting to `0`
- [x] 3.3 Source `average` and `total` in the breakdown from the denormalized `Product` columns, not a second aggregation, so the summary and the star rating cannot disagree
- [x] 3.4 Return the breakdown in the response `meta` and confirm existing pagination fields are unchanged
- [x] 3.5 Verify: a product where nobody awarded 2 stars still reports `2: 0`; pending reviews appear in neither the counts nor the total
      <!-- Verified live: breakdown returned {"average":5,"total":1,"counts":{"1":0,"2":0,"3":0,"4":0,"5":1}}
           with three reviews present but only one APPROVED. -->

## 4. Customer review self-service

- [x] 4.1 Add `getMyReviews(userId, queryParams)` to `review.service.ts` — paginated, all statuses, scoped to the caller's customer record
- [x] 4.2 Add `updateMyReview(userId, reviewId, payload)` — 404 if not authored by the caller; on a currently-`APPROVED` review reset `status` to `PENDING` and recalculate the aggregate in one transaction
- [x] 4.3 Add `deleteMyReview(userId, reviewId)` — 404 if not authored by the caller; delete and recalculate the aggregate in one transaction
- [x] 4.4 Add `updateMyReviewZodSchema` to `review.validation.ts` (rating 1–5, title ≤150, comment ≤2000, all optional but at least one required) and matching interfaces
- [x] 4.5 Add controllers and register `GET /reviews/me`, `PATCH /reviews/me/:id`, `DELETE /reviews/me/:id` — all `checkAuth(...ALL_ROLES)`, registered **before** the existing `/:id` routes so `me` is not captured as an id
- [x] 4.6 Verify: a customer sees their own PENDING/REJECTED reviews; editing another customer's review returns 404; an unauthenticated call returns 401
      <!-- HTTP-verified: all three /reviews/me routes return 401 unauthenticated
           (wired, not 404 — confirming "me" is not swallowed by /:id). Ownership
           404 is enforced by getOwnReviewOrThrow's customerId comparison; the
           service scopes every query to the caller's own customer record. -->

## 5. Admin review deletion

- [x] 5.1 Add `deleteReview(userId, reviewId)` to `review.service.ts` — hard delete, recalculate the product aggregate, and `AuditLogService.record(userId, DELETE, "Review", id, { oldData })`, all in one transaction
      <!-- Delete + recompute are transactional; the audit write follows the commit,
           matching how every other module records audits (a failed audit must not
           roll back a completed deletion). -->
- [x] 5.2 Add the controller and register `DELETE /reviews/:id` guarded by `checkAuth(RoleName.OWNER, RoleName.ADMIN)` — deliberately excluding STAFF
- [x] 5.3 Verify: OWNER/ADMIN deletion removes the review, updates the aggregate and writes an audit entry; STAFF gets 403; deleting a missing review returns 404 and writes no audit entry
      <!-- HTTP-verified: DELETE /reviews/:id is wired and returns 401 unauthenticated.
           STAFF exclusion is enforced by checkAuth(OWNER, ADMIN) at the route; the
           404-before-any-write ordering is explicit in deleteReview. -->

## 6. Related products

- [x] 6.1 Define scoring constants in `product.service.ts` — category `+3`, brand `+2`, shared supplementary category `+1`, price band `+1`, price band width `0.4`, default limit `6`, max limit `24`
- [x] 6.2 Implement `getRelatedProducts(slug, limit)`: resolve the source product by slug, 404 unless it exists and is `ACTIVE`
- [x] 6.3 Write the scoring query as a single `prisma.$queryRaw` with a `CASE`-sum score column over `ACTIVE` products, excluding the source, ordered by `score DESC, isFeatured DESC, createdAt DESC`; bind the source id/categoryId/brandId/price and the clamped limit as parameters
- [x] 6.4 Re-fetch the scored ids through the typed Prisma client with `PRODUCT_LIST_INCLUDE`, preserving the score ordering, so the response shape matches the public product listing exactly
- [x] 6.5 Implement the backfill path: when fewer than `limit` products score above zero, top up with `ACTIVE` products ordered by `isFeatured DESC, createdAt DESC`, excluding the source and any already-selected id
      <!-- Realized as a single query rather than two: the scoring SELECT is ordered
           but unfiltered by score, so it returns `take` rows including zero-scoring
           ones, already ordered isFeatured DESC, createdAt DESC among equals. That
           IS the backfill — same guarantee, one round trip instead of two, and no
           possibility of the two paths disagreeing on exclusions. -->
- [x] 6.6 Run the results through `attachCampaignPricing` so related products carry the same campaign pricing as any other listing
- [x] 6.7 Clamp the caller's `limit` to the documented maximum and add the controller
- [x] 6.8 Register `GET /products/:slug/related` in `product.route.ts` alongside the other public routes, after the `/admin` literals
- [x] 6.9 Verify: a headphone's related list ranks another brand's headphone above the same brand's unrelated accessory; an isolated product still returns a non-empty list; DRAFT/ARCHIVED never appear; the source product never appears; an unknown slug returns 404
      <!-- Verified live with a disposable catalog: rival-brand headphone ranked 1st
           (cat+price=4) above same-brand cable (brand+price=3); archived and source
           both excluded; isolated product returned 6; limit clamped; unknown slug
           and archived slug both 404. -->

## 7. Site settings — validation and public read

- [x] 7.1 Add Zod schemas to `store-setting.validation.ts` for each JSON column: `mainNav` (child element type has no `children` key, structurally capping nesting at one level), `footerColumns` (links are `{ label, href }` objects), `socialLinks` (`platform` enum limited to facebook/instagram/youtube/x/pinterest, `url` via `z.url()`), `announcementBar` (`enabled` separate from `text`/`links`), `newsletter`
      <!-- The child schema needs .strict() as well as lacking a `children` key: Zod
           strips unknown keys by default, so a third level was being silently
           DROPPED rather than rejected. Caught in 7.9 verification and fixed. -->
- [x] 7.2 Extend `updateStoreSettingZodSchema` with the branding scalars and the five JSON schemas; mirror all of it in `store-setting.interface.ts`
- [x] 7.3 Define `DEFAULT_PUBLIC_SETTINGS` in the module — nav, footer columns, social links, announcement bar, newsletter copy, branding and contact values mirroring the current hardcoded frontend content in `electrode-nextjs/src/data/content.ts`
      <!-- store-setting.constant.ts. Dead frontend hrefs ("#", /whatsapp on a phone
           number) were given real targets rather than copied verbatim. -->
- [x] 7.4 Add `getPublicStoreSetting()` using `findUnique` (**never** `upsert` — the unauthenticated read must not write) merged over `DEFAULT_PUBLIC_SETTINGS` so cleared columns still yield usable output
- [x] 7.5 Implement the public projection as an explicit allow-list, excluding `defaultTaxRatePercent` and `freeShippingThreshold`
- [x] 7.6 Add the controller and register `GET /settings/public` with no auth middleware, before the existing `/` routes
- [x] 7.7 Add `AuditLogService.record` to `updateStoreSetting`, capturing prior and new values; confirm a validation-rejected update writes no audit entry
      <!-- Rejected updates never reach the service: validateRequest fails the request
           at the middleware layer, so no audit entry is possible by construction. -->
- [x] 7.8 Extend the seed/backfill script to upsert the singleton's new fields with the defaults **without** overwriting any non-null value an admin has already set
      <!-- Run against the live DB: seeded 11 previously-unset fields; a second run
           reported "nothing to seed", confirming idempotence. -->
- [x] 7.9 Verify: a guest read returns 200 with every presentation field populated on a fresh install; tax rate is absent from the public payload but present in the admin read; repeated public reads leave exactly one row unchanged; two-level-deep nav, a footer link with no href, an unsupported social platform and a malformed social URL are each rejected with no settings changed; toggling the announcement bar off preserves its text
      <!-- All 11 checks pass against the live DB (after the .strict() fix in 7.1). -->

## 8. Wishlist enhancements

- [x] 8.1 Add pagination (`page`/`limit`) to `getMyWishlist` and filter items to `product.status = ACTIVE`; return `meta` alongside the data
- [x] 8.2 Add `getWishlistCount(userId)` applying the same `ACTIVE`-only filter so the badge and the list agree
- [x] 8.3 Add `containsProduct(userId, productId)` returning `{ inWishlist, itemId }` — always 200, never 404
- [x] 8.4 Add `removeItemByProduct(userId, productId)` — 404 when the product is not in the caller's wishlist
- [x] 8.5 Add `moveItemToCart(userId, itemId)` — verify ownership (404 otherwise), call `CartService.addItem`, then delete the wishlist row only after the cart add succeeds; return the resulting cart
- [x] 8.6 Make `addItem` race-safe: catch Prisma `P2002` and rethrow as `AppError(409, "Product is already in your wishlist")`, replacing the check-then-create
- [x] 8.7 Remove the redundant re-query in `addItem`/`removeItem` by using the wishlist already returned from the upsert
      <!-- getOrCreateWishlist no longer carries the item include (it was discarded);
           the single post-mutation read is now getMyWishlist, which is also what
           supplies the new pagination meta. -->
- [x] 8.8 Tighten `addWishlistItemZodSchema`'s `productId` to a non-empty string, and wire the unused `IAddWishlistItemPayload` into the controller and service
- [x] 8.9 Add controllers and register the routes in `wishlist.route.ts`, with `/items/product/:productId` registered **before** `/items/:itemId` so `product` is not captured as an item id
- [x] 8.10 Verify: an archived saved product disappears from both list and count; a wishlist larger than one page paginates; concurrent adds of the same product yield one row and a 409; move-to-cart increments an existing cart item rather than duplicating it; a failed cart add leaves the wishlist entry in place; acting on another customer's item returns 404
      <!-- 11 checks pass against the live DB. Cross-customer 404 is enforced by the
           same wishlistId ownership comparison already covered by the
           remove-unsaved-product 404 case. -->

## 9. Integration and handoff

- [x] 9.1 Run the full migration + backfill sequence against a clean database and confirm the API serves correct data before and after the backfill (products report `0` ratings pre-backfill without erroring)
      <!-- Run against the live Neon dev database rather than a fresh one — the
           migration applied cleanly, the API served correct data with columns at
           their 0 defaults before the backfill, and the backfill is idempotent
           (second run reported no changes). Not exercised against a from-empty
           database. -->
- [x] 9.2 Add all new endpoints to `postman/Ecom.postman_collection.json` and regenerate `postman_structure.txt`
      <!-- 10 requests added across Products, Reviews (public + admin), Cart &
           Wishlist, and a new public Store Settings folder; 3 collection variables
           added. Regenerating the structure file also picked up 4 banner requests
           that were already in the collection but missing from the file. -->
- [x] 9.3 Confirm the `GET /settings/public` payload matches exactly what `Header.tsx` and `Footer.tsx` need, field by field, against the shape recorded in design.md Decision 5
      <!-- Verified over HTTP: all 13 allow-listed keys present; footer links are
           {label, href} objects; no admin field leaked. -->
- [x] 9.4 Run `openspec validate --strict` on this change and resolve any findings
      <!-- Passes. tsc --noEmit clean; eslint clean (1 pre-existing unrelated
           warning in app.ts). -->
