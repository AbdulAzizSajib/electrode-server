# Tasks

Deploy order constraint from design.md — Migration Plan: **section 2 (storefront allow-list) must ship before or with section 4 (backend firing).** Sections 1–3 are inert on their own; a backend firing a tag the storefront does not allow-list only logs a 400.

## 1. Storefront: declare a tag on every cached read

Each service exports a `*_CACHE_TAG` constant beside its existing `*_REVALIDATE_SECONDS`, and passes `tags: [TAG]` alongside the `revalidate` already there. `tags` without `revalidate` does nothing — never add one without confirming the other is present.

Call-site counts below are verified; **every** call site for a resource must carry the tag, or the untagged one keeps serving stale data after the others refresh.

- [x] 1.1 `nextjs/src/services/campaign.ts` — `CAMPAIGNS_CACHE_TAG = "campaigns"`, 1 call site (line ~33)
- [x] 1.2 `nextjs/src/services/banner.ts` — `BANNERS_CACHE_TAG = "banners"`, 1 call site (line ~66)
- [x] 1.3 `nextjs/src/services/brand.ts` — `BRANDS_CACHE_TAG = "brands"`, 1 call site (line ~19)
- [x] 1.4 `nextjs/src/services/category.ts` — `CATEGORIES_CACHE_TAG = "categories"`, **2 call sites** (lines ~45 and ~70)
- [x] 1.5 `nextjs/src/services/page.ts` — `PAGES_CACHE_TAG = "pages"`, 1 call site (line ~29)
- [x] 1.6 `nextjs/src/services/product.ts` — `PRODUCTS_CACHE_TAG = "products"`, **3 call sites** (lines ~204, ~267, ~297)
- [x] 1.7 `nextjs/src/services/review.ts` — `REVIEWS_CACHE_TAG = "reviews"`, 1 call site (line ~53)
- [x] 1.8 Re-grep each of the seven files for `apiFetch` and confirm no call site was missed — the counts above are from the current tree and a service may have grown

## 2. Storefront: allow-list the seven tags

- [x] 2.1 `nextjs/src/app/api/revalidate/route.ts` — import the seven new constants and add them to `ALLOWED_TAGS` (grows 5 → 12)
- [x] 2.2 Keep `ALLOWED_TAGS` an exact-match `Set` — no prefix matching (design.md Decision 1). Update the comment block to note the set now covers all merchant-editable resources, not a hand-picked few

## 3. Backend: tag constants

- [x] 3.1 `server/src/app/utils/revalidateStorefront.ts` — seven exported constants beside `STORE_SETTINGS_TAG` / `SEO_CONFIG_TAG`, each with a comment naming the storefront constant it mirrors (the existing two set the style)
- [x] 3.2 Add the exported predicate reporting whether both a secret and a base URL are present (design.md Decision 7). Logged positively at boot from `server.ts`; `api.ts` stays covered by the existing warn-once

## 4. Backend: fire on every write

Verified: each of the seven models is written **only** from its own service — no cross-module writes exist for any of them. The audit in design.md Decision 4 is therefore per-service, but still per-*write*, not per-function-name: several services below have mutating paths beyond the CRUD trio.

Rules for every call (design.md Decision 5):
- After the write commits, **outside** any `prisma.$transaction`, never inside it
- Not awaited, not wrapped in try/catch — `revalidateStorefront` already swallows everything
- Once per logical operation, not once per row in a loop

- [x] 4.1 `campaign.service.ts` — `createCampaign`, `updateCampaign`, `deleteCampaign`. Note `updateCampaign` returns from inside a `$transaction`; the fire goes after it resolves. This module currently imports nothing from `utils/`
- [x] 4.2 `banner.service.ts` — `createBanner`, `updateBanner`, `deleteBanner`
- [x] 4.3 `brand.service.ts` — `createBrand`, `updateBrand`, `deleteBrand`, **and `bulkCreateBrands`** (fires once after the bulk, not per brand)
- [x] 4.4 `category.service.ts` — `createCategory`, `updateCategory`, `deleteCategory`
- [x] 4.5 `page.service.ts` — `createPage`, `updatePage`, `deletePage`
- [x] 4.6 `product.service.ts` — `createProduct`, `updateProduct`, `deleteProduct`, **`addProductCategory`, `removeProductCategory`** (both change which listings a product appears in). Also found: `deleteProduct` has TWO return paths — the archive branch (taken whenever a product has order history) fires as well as the hard delete
- [x] 4.7 `review.service.ts` — `createReview`, **`updateReviewStatus`** (moderation — the path most likely to be missed, and the one that decides whether a review is publicly visible at all), **`replyToReview`**, `updateMyReview`, `deleteMyReview`, `deleteReview`
- [x] 4.8 Re-read each service after wiring and confirm no mutating path was skipped — a create-only wiring leaves deletes stale, which is the exact bug that prompted this change. Verified by script: every `create*`/`update*`/`delete*`/`bulk*`/`add*`/`remove*` function in the seven modules contains a fire

### Explicit exclusion — do not "fix" this later

- [x] 4.9 **Order-placement stock decrements do NOT fire `PRODUCTS_TAG`** (design.md Risks). Stock is written from `order`, `stock`, `return`, `refund`, `purchase-order` and `warehouse` services; firing there would drop the catalog tag on every order and make the cache worthless. Merchant-initiated inventory edits **do** fire it. Add a comment at the exclusion point saying so, so the omission is not read as an oversight. Done: NOTE block at the decrement in `order.service.ts`, and `adjustStock` in `stock.service.ts` fires with a comment pointing at the asymmetry

### Cross-resource fires — opt-in only, never inferred

Design.md Decision 6: a tag fires for the resource written, not for resources that embed it. These two are stated explicitly with a comment naming why, exactly as `landing-page.service.ts` already fires two tags.

- [x] 4.10 `campaign.service.ts` also fires `PRODUCTS_TAG` — a campaign write changes `campaignPrice` on every product it discounts, and those are cached under `products`. Without this, a deleted campaign removes the Deal of the Week section but leaves discounted prices on product cards
- [x] 4.11 `review.service.ts` also fires `PRODUCTS_TAG` — `recalculateProductRating` writes the product's aggregate rating, which product cards and listings render. Fire after the recalculation, not before

## 5. Verification

- [x] 5.1 Write `server/scripts/verify-revalidate-tags.ts` — asserts the exported backend tag constants and the storefront's `ALLOWED_TAGS` entries are the same set, failing on a tag fired-but-not-allowed and on one allowed-but-never-fired. Read the storefront route as **text**, not by importing it (design.md Decision 3 — it imports `next/cache`). Added a third check the plan did not anticipate: a tag declared and allow-listed but never passed to `apiFetch`, which `tags`-without-`revalidate` makes indistinguishable from a working one. Also note backend tags live in **two** homes — `revalidateStorefront.ts` for cross-module tags, a module's own `.constant.ts` for single-module ones (blog, testimonial, landing-page) — and the script reads both
- [x] 5.2 **Run 5.1 before reviewing the wiring**, not after — a name mismatch is the most likely defect in this change and is otherwise silent. Result: 12 backend tags, 12 allow-listed, all matched. Negative-tested by injecting a typo into `PRODUCTS_TAG`; the script failed with both expected errors and was then restored
- [ ] 5.3 Confirm `STOREFRONT_REVALIDATE_SECRET` (server) and `REVALIDATE_SECRET` (storefront) are set to the same value in every environment. Existing config, but this change is what makes its absence expensive — **left for the user; the values are per-environment**
- [ ] 5.4 Manual check against the reported bug: create a campaign with a future `endsAt`, confirm the Deal of the Week countdown renders, delete the campaign, reload once — the section must be gone immediately, not after five minutes — **needs a running stack; left for the user**
- [ ] 5.5 Manual check of a non-CRUD path: change a review's status from the admin and confirm the storefront reflects it on the next request — **needs a running stack; left for the user**

## 6. Documentation

- [x] 6.1 `CLAUDE.md` — update the cache-invalidation section to name the full 12-tag set and state the whole-resource granularity rule, plus the stock exclusion from 4.9. The existing text describes "adding a cached resource means adding its tag" as a five-resource convention; it is now a twelve-resource one
- [x] 6.2 Resolve design.md's open question (where the boot-time configuration log belongs, given `api.ts` has no listen) while writing 3.2 — it changes no requirement and no other task. **Resolved:** logged positively from `server.ts` inside the listen callback, so it runs once per boot rather than per serverless invocation; `api.ts` stays covered by the existing warn-once inside `revalidateStorefront`, which fires on the first attempt rather than at boot
