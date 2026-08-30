## Why

The storefront (`electrode-nextjs`) cannot finish four customer-facing surfaces because the API does not expose the data they need. Star ratings cannot be rendered anywhere because `Product` carries no rating aggregate. The product detail page fakes "You May Also Like" by re-querying the catalog by category and slicing six results. The header and footer are entirely hardcoded — nav links, footer link columns, social links, contact details and the announcement bar all live in `src/data/content.ts`, and the one settings endpoint that exists is admin-only, so a guest page cannot read it. The wishlist API exists but lacks the productId-scoped operations a heart-toggle button needs, so the wishlist page ships as a static empty state.

Three of the four areas already have working backend modules (`review`, `wishlist`, `store-setting`). This change closes the specific gaps that block the frontend, and adds the one genuinely missing capability: related products.

## What Changes

### Reviews — aggregation and self-service (module exists)

- Add `averageRating` (Decimal 3,2, default 0) and `reviewCount` (Int, default 0) to `Product`, recomputed from `APPROVED` reviews whenever a review is approved, rejected, hidden, edited, or deleted.
- Include both fields in public product list and detail responses so `ProductCard` and `ProductDetail` can render stars.
- Add a rating breakdown (`average`, `total`, per-star counts 1–5) to the meta of `GET /products/:id/reviews`, for the "4.5 out of 5, 87 reviews" histogram.
- Add `GET /reviews/me` — a customer lists their own reviews across all statuses, including `PENDING` and `REJECTED`.
- Add author-scoped `PATCH /reviews/me/:id` and `DELETE /reviews/me/:id`. Editing an approved review resets its status to `PENDING` for re-moderation.
- Add admin `DELETE /reviews/:id` — OWNER/ADMIN hard-delete of any review, audit-logged.
- **BREAKING** (frontend-visible, additive on the wire): public review list responses gain a `meta.ratingBreakdown` object. Existing consumers are unaffected; no field is removed or renamed.

### Related products — new capability

- Add `GET /products/:slug/related?limit=` (public, no auth). Scores `ACTIVE` candidates: same primary category (+3), same brand (+2), shares a supplementary `ProductCategory` (+1), price within ±40% of the source product (+1). Orders by score, then `isFeatured`, then `createdAt`. Excludes the source product. Backfills with featured/newest `ACTIVE` products when fewer than `limit` candidates score above zero, so the endpoint never returns an empty list on a populated catalog.
- No new tables, no admin curation. Manual pinning is explicitly out of scope (see Non-Goals in design.md).

### Site settings — public, header/footer-complete

- Extend `StoreSetting` with branding fields (`logoUrl`, `siteName`/`siteNameAccent`, `aboutText`, `copyrightText`) and JSON columns for the structured content the header and footer need: `mainNav`, `footerColumns`, `socialLinks`, `announcementBar`, `newsletter`.
- Add `GET /settings/public` — unauthenticated, cacheable, returning only storefront-safe fields in the shape `Header.tsx` and `Footer.tsx` consume. Admin-only fields (`defaultTaxRatePercent`, `costPrice`-adjacent config) are excluded from this payload.
- Admin `PATCH /settings` accepts and validates the new JSON structures against Zod schemas so malformed nav trees cannot be persisted.
- Seed the singleton row with defaults mirroring today's hardcoded frontend content, so the storefront renders identically on first deploy.
- Settings mutations become audit-logged, matching every other admin-mutating module.

### Wishlist — product-scoped operations (module exists)

- Add `DELETE /wishlist/items/product/:productId` — remove by product, not by wishlist-item id.
- Add `GET /wishlist/contains/:productId` — returns whether the product is in the caller's wishlist, so a heart button can render its state without fetching the full list.
- Add `GET /wishlist/count` — for the header badge, which currently shows a hardcoded `0`.
- Add `POST /wishlist/items/:itemId/move-to-cart` — atomically adds to cart and removes from the wishlist in one transaction.
- Paginate `GET /wishlist` (`page`/`limit`) and filter out non-`ACTIVE` products, matching public catalog behavior. **BREAKING**: the response gains a `meta` block and is no longer guaranteed to contain every item in one call.
- Make `addItem` race-safe by catching the P2002 unique violation and returning the intended 409 instead of a raw Prisma error.

## Capabilities

### New Capabilities

- `api/site-settings`: Public, storefront-facing store configuration — branding, navigation menu, footer link columns, social links, announcement bar, newsletter copy and contact details — served unauthenticated and managed by admins.

### Modified Capabilities

- `api/catalog`: Adds the related-products requirement, and makes the existing "reviews summary" clause of the public-browse requirement concrete by requiring `averageRating`/`reviewCount` on public product responses.
- `api/cart-wishlist`: Adds product-scoped wishlist reads and removal, a count endpoint, move-to-cart, and pagination/active-only filtering on the wishlist listing.
- `api/support-and-admin`: Extends the store-settings singleton requirement to cover a public read projection and audit-logged mutations. Adds review moderation-lifecycle requirements: rating aggregates stay consistent with `APPROVED` reviews, customers manage their own reviews, and admins may delete any review.

## Impact

**Database (3 migrations):**
- `Product`: `+averageRating Decimal @db.Decimal(3,2) @default(0)`, `+reviewCount Int @default(0)`, `@@index([averageRating])` for rating sorts.
- `StoreSetting`: `+logoUrl`, `+siteNameAccent`, `+aboutText`, `+copyrightText`, `+mainNav Json?`, `+footerColumns Json?`, `+socialLinks Json?`, `+announcementBar Json?`, `+newsletter Json?`.
- Backfill: one-time recompute of `averageRating`/`reviewCount` for existing products; seed of the `StoreSetting` singleton defaults.

**Modules touched:**
- `src/app/module/review/` — service, controller, route, validation, interface (aggregation, self-service, admin delete).
- `src/app/module/product/` — service, controller, route (related endpoint; aggregate fields in includes).
- `src/app/module/store-setting/` — all five files (public projection, JSON validation, audit logging).
- `src/app/module/wishlist/` — all five files (four new endpoints, pagination, race-safety).
- `src/app/routes/index.ts` — no new mounts required; all new routes live under existing prefixes. `GET /products/:slug/related` must be registered **before** `GET /products/:slug` is irrelevant (different segment count) but after `/admin` literals, per the module's existing ordering convention.

**Consumers:**
- `electrode-nextjs`: `Header.tsx`, `Footer.tsx`, `layout.tsx` (add `getSiteSettings()` to the existing `Promise.all`, never-throw fallback), `ProductCard`, `ProductDetail`, `wishlist/page.tsx`, `products/[handle]/page.tsx` (replace the synthesized related query). Frontend work is downstream and not part of this change.
- `electrode-admin`: needs UI for the new settings JSON structures and review deletion. Also downstream.
- Postman collection (`postman/Ecom.postman_collection.json`) gains the new endpoints.

**Non-breaking for existing clients** except the two items marked **BREAKING** above, both of which are additive-shape changes to responses rather than removals.
