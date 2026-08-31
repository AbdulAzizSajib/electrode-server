## 1. Schema and migrations

- [x] 1.1 In `prisma/schema/product.prisma`, add `totalSold Int @default(0)` to `Product` with a comment mirroring the `averageRating` block above it — state that it is denormalized because Prisma cannot `orderBy` a relation aggregate, and that it counts only payments that reached `PAID` (design.md Decisions 1-2)
- [x] 1.2 Add `@@index([totalSold])` to `Product` alongside the existing `averageRating` index
- [x] 1.3 In `prisma/schema/enums.prisma`, add `enum CampaignPlacement { DEAL_OF_WEEK FLASH_SALE }` near `BannerPlacement`, with a comment noting `FLASH_SALE` is defined but not yet rendered by any storefront section (design.md Non-Goals)
- [x] 1.4 In `prisma/schema/Campaign.prisma`, add `placement CampaignPlacement?` and `@@index([placement])`; comment that it is nullable because a placement is opt-in and most campaigns occupy no slot (design.md Decision 4)
- [x] 1.5 Generate both migrations with `--create-only` and inspect the SQL: `totalSold` must be `ADD COLUMN ... NOT NULL DEFAULT 0` plus `CREATE INDEX` with no table rewrite; the campaign migration must be `CREATE TYPE` plus a nullable `ADD COLUMN` plus `CREATE INDEX`, with no `UPDATE` of existing rows
      <!-- The inspection this task asks for earned its keep. Prisma emitted ONE
           migration containing three unrequested statements:
             DROP INDEX "Product_name_trgm_idx" / "Product_sku_trgm_idx" / "Brand_name_trgm_idx"
           Those are the hand-written GIN trigram indexes from
           add-product-search-api. Prisma's schema language cannot express an
           operator-class index, so the client does not know they exist and
           treats them as drift to be removed — silently deleting the indexes
           that keep product search off a full table scan.
           Hand-wrote the two migrations instead, split per the migration plan,
           with the DROP INDEX statements removed. Verified post-apply that all
           three trigram indexes are still present in pg_indexes.
           Pre-existing hazard, not introduced here: ANY future `prisma migrate
           dev` on this schema will re-emit these drops. -->
      <!-- Applied migrations: 20260831083300_add_product_total_sold,
           20260831083400_add_campaign_placement. Both purely additive. -->
      
- [x] 1.6 Apply both migrations, run `prisma generate`, and confirm the client exports `CampaignPlacement` with both values and that `Product` carries `totalSold`
- [x] 1.7 Verify existing rows are untouched: every product reads `totalSold = 0`, every campaign reads `placement = null`, and no other column changed

## 2. Payment transitions — the `totalSold` write path

Design.md Decision 3: these transitions do not exist yet. `recordPayment` only ever creates a payment, and `createRefund` never marks one refunded. Build the transition first, then hang the counter on it.

- [x] 2.1 Add a `PaymentService` path that updates an existing `Payment.status` (COD collection has no way to mark a payment `PAID` today — a real gap independent of this change). Include the route, controller, validation, and OWNER/ADMIN/STAFF authorization consistent with the rest of `payment.route.ts`
- [x] 2.2 Write a single helper that applies a `totalSold` delta for one order's items — takes the transaction client, an order id, and a sign; sums `OrderItem.quantity` per `productId` and applies it. Both the increment and decrement call it, so the two paths cannot diverge
- [x] 2.3 Floor the counter at zero on every decrement (design.md Decision 2 — a negative count sorts to the *top* of an ascending listing, so this is correctness, not defensiveness)
- [x] 2.4 Fire the increment only on a transition **into** `PAID` from a non-`PAID` status — read the current status inside the transaction and compare. Recording the same payment as `PAID` twice must not double-count
- [x] 2.5 Fire the decrement only on a transition **out of** `PAID` into `REFUNDED` or `CANCELLED`. A payment refunded from `PENDING` never incremented and must not decrement
- [x] 2.6 In `PaymentService.recordPayment`, wrap the existing `payment.create` in `prisma.$transaction` and increment when the created payment's status is `PAID` (prepaid orders arrive already-paid, so creation is itself a transition into `PAID`)
- [x] 2.7 In `RefundService.createRefund`, mark the linked `Payment` as `REFUNDED` inside the existing `$transaction` — the one that already completes the `ReturnRequest` — and apply the decrement there
- [x] 2.8 Confirm every counter write shares a transaction with the payment write that triggered it (design.md Decision 3: a committed `PAID` with a failed counter update is silent permanent drift)
- [x] 2.9 Verify the guest COD path end to end: placing a guest order creates a `PENDING` payment and leaves `totalSold` unchanged; marking that payment `PAID` increments it by the ordered quantity. This is the case that rules out counting at placement (design.md Decision 2)

## 3. Backfill script

- [x] 3.1 Write a standalone, re-runnable script that sets each product's `totalSold` to the sum of `OrderItem.quantity` over orders having a `PAID` payment — an absolute `SET`, never `+=`, so re-running converges rather than doubling (design.md Decision 6)
- [x] 3.2 Use the same payment predicate as the live path in section 2; if the two disagree the backfill silently corrupts the counter it is meant to repair
- [x] 3.3 Have the script report how many products it updated and the top few by `totalSold`, so an operator can eyeball the result rather than trusting a silent exit
- [x] 3.4 Run it, then verify one known-selling product's count against its order history by hand
- [x] 3.5 Run it a second time and confirm every count is unchanged (proves idempotency, which is what makes it the drift-repair procedure)

## 4. Public product listing — filter and sort allowlist

- [x] 4.1 Define the `sortBy` allowlist for the public listing — `createdAt`, `price`, `name`, `averageRating`, `totalSold` — with a comment stating the rule that keeps it checkable: a field is sortable only if its value is already in the public product payload (design.md Decision 5)
- [x] 4.2 Add a Zod schema for the public product query validating `sortBy` against that allowlist, and wire it into the `GET /products` route. `product.validation.ts` currently has no public-query schema, so this is a new export
- [x] 4.3 Reject a disallowed `sortBy` with a 400 naming the parameter. Do **not** fall back to the default ordering — a 200 in an order the caller did not request and cannot detect is the failure mode this task exists to prevent
- [x] 4.4 Verify `?sortBy=costPrice&sortOrder=desc` on `GET /products` now returns 400 and no product data. Before this change it returned the catalog ordered by supplier cost (proposal.md — the disclosure being closed)
- [x] 4.5 Confirm the admin listing is unaffected and still sorts by any column — restricting it would break admin tooling for no security gain (design.md Decision 5)
- [x] 4.6 In `getPublicProducts`, read `isFeatured` from the query params and add it to the `where` clause. Follow the existing `brand` pattern; the `ACTIVE` status filter must still apply, so a featured `DRAFT` product stays invisible
- [x] 4.7 Coerce `isFeatured` from its query-string form — it arrives as `"true"`/`"false"`, and a bare truthiness check would make `isFeatured=false` filter to featured products
- [x] 4.8 Verify `?sortBy=totalSold&sortOrder=desc` orders by units sold with never-sold products last reading 0, and that `?isFeatured=true&category=<id>` composes both filters (specs: catalog scenarios)

## 5. Public campaign endpoint

- [x] 5.1 Extract the campaign eligibility predicate — `ACTIVE` plus the `startsAt`/`endsAt` window — currently inline in `getActiveDiscountsForProducts` (`campaign.service.ts:98-110`), into one shared constant used by both it and the new read. If these drift, a campaign can be served into a slot while its discounts are not applying, and the countdown runs on undiscounted prices (design.md Decision 4)
- [x] 5.2 Add `CampaignService.getActiveCampaignByPlacement(placement)` returning the eligible campaign for that slot with its products, or null. Order by `startsAt` descending and take one, so the most recently started campaign wins (design.md Decision 4)
- [x] 5.3 Return the campaign's products with campaign pricing already applied, reusing the existing discount math rather than recomputing it — `ProductService.attachCampaignPricing` already produces the exact shape the storefront's `toProduct` consumes
- [x] 5.4 Return only `name`, `description`, `startsAt`, `endsAt`, and the priced products. Do not expose `discountType`/`discountValue` or administrative fields on this public route (specs: marketing — exposes only what a storefront renders)
      <!-- Caught by the 5.11/5.12 verification, not by inspection: selecting only
           the campaign's own safe fields was NOT sufficient. attachCampaignPricing
           attaches the discount rule to every product as `activeCampaign`
           ({campaignId, campaignName, discountType, discountValue}), so the
           discount config re-entered through the products array. Now stripped
           explicitly; campaignPrice (what the shopper pays) is retained. -->
- [x] 5.5 Report `endsAt` as null when the campaign has none — never a computed or default deadline. This is what the old fake seven-day timer did, and reproducing it server-side would defeat the change
- [x] 5.6 Restructure `campaign.route.ts`: the blanket `router.use(checkAuth(OWNER, ADMIN))` at the top makes every route admin-only by construction, so the public route cannot simply be appended. Declare `GET /active` before the `router.use`, and confirm every other campaign route is still admin-guarded afterward
- [x] 5.7 Declare `GET /active` above any `/:id` route so Express's declaration-order matching cannot let the parameterised route capture the literal path — the same ordering hazard documented in `product.route.ts:57`
- [x] 5.8 Validate `?placement=` against the `CampaignPlacement` enum and reject an unrecognised value with 400 (specs: marketing — unknown placement)
- [x] 5.9 Add `placement` to `createCampaignZodSchema` and `updateCampaignZodSchema` as an optional enum, with a comment noting the Zod enum is hand-synced with the Prisma enum and the two must change together
- [x] 5.10 Derive `placement` (and, while there, the existing hand-written `status` union) in `campaign.interface.ts` from the generated Prisma enums rather than adding another hand-written string union. `add-hero-banner-placements` shipped a build break from exactly this third hand-written copy (its tasks.md 2.1); this adopts that fix from the start (design.md Risks)
- [x] 5.11 Verify each empty-slot case returns an empty result rather than an error: no campaign declares the placement, the only one is `PAUSED`, it has not started, and it has expired (specs: marketing scenarios)
- [x] 5.12 Verify the resolution rule with two eligible campaigns in one slot — the later `startsAt` is served, and the other's discounts still apply to its products

## 5b. Close the `costPrice` field disclosure (added scope, user-approved)

Found while verifying section 5, not anticipated by the plan. Decision 5 closed the *ordering* channel on `costPrice`, but `PRODUCT_LIST_INCLUDE`/`PRODUCT_DETAIL_INCLUDE` use Prisma `include`, which returns every scalar column — so `costPrice` was being sent in the body of every public product response. Pre-existing (verified unchanged at `git show HEAD`), and null on all seeded products, so nothing leaked yet. Shipping the sort allowlist without this would have been a lock beside an open window. User approved fixing it here.

- [x] 5b.1 Add `PUBLIC_PRODUCT_SCALARS` — an explicit allowlist of the product columns a public response may carry, so a column added to `Product` later is private until someone opts it in
- [x] 5b.2 Add `PUBLIC_PRODUCT_LIST_SELECT` / `PUBLIC_PRODUCT_DETAIL_SELECT`; project `variants` too, since `ProductVariant` carries its own `costPrice`
- [x] 5b.3 Point all four public read paths at them — `getPublicProducts`, `getPublicProductBySlug`, `getRelatedProducts`, `getActiveCampaign`. Admin reads keep the `include` forms
- [x] 5b.4 Add `QueryBuilder.select()`; it *replaces* rather than merges, so a caller-supplied `?fields=costPrice` cannot union the column back in
      <!-- `fields()` was a second route to the same disclosure: it builds a
           select from arbitrary caller-named columns. getPublicProducts never
           calls fields(), so it was inert there, but a merging select() would
           have opened it. -->
- [x] 5b.5 Verify `costPrice` is absent from the listing, detail and related endpoints, that `?fields=id,costPrice` cannot re-expose it, that every public surface still returns 200 with its relations intact, and that the admin listing still includes it

## 6. Frontend — services and types

- [x] 6.1 Add `isFeatured?: boolean` and `sortBy`/`sortOrder` to `ProductQuery` in `types/product.ts`, typing `sortBy` as the allowlist union so a disallowed value is a compile error rather than a runtime 400
- [x] 6.2 Add campaign types to `types/` — the API shape and the view model, following the `ApiBanner`/`Banner` split in `types/banner.ts`
- [x] 6.3 Create `services/campaign.ts` with `getCampaignByPlacement(placement)`. Follow `services/banner.ts`: return null on failure rather than throwing, so an outage omits the section instead of failing the page
- [x] 6.4 Set the campaign revalidate window to match `BANNER_REVALIDATE_SECONDS` (300) — a campaign is merchandising, not catalog, and changes on the order of days. Note in a comment that this bounds how long an expired deal can linger in cache, which is why the client-side expiry in 7.3 is needed
- [x] 6.5 Map the campaign's products through the existing `toProduct` — it already folds `campaignPrice` into the displayed price with the base price struck through (`services/product.ts:66-70`), which is the `-11%` badge and cut price in the target UI

## 7. Frontend — homepage sections

- [x] 7.1 Change `CountdownTimer` to take a **required** `endsAt`, replacing `daysFromNow = 7`. Required, not optional-with-default: it turns every remaining fake countdown into a compile error instead of leaving one silently in place (design.md Decision 8)
- [x] 7.2 Compute remaining time in `useEffect` and render a stable placeholder on the server pass. The current component computes it during render, which is a latent hydration mismatch that a real deadline would otherwise preserve
- [x] 7.3 Render nothing once the deadline passes, and have `DealOfWeek` treat an expired campaign as an empty slot — covering the window between page render and expiry, and a cached response outliving its `endsAt`
- [x] 7.4 Change `DealOfWeek` to take the campaign, rendering its own `name` and `description` instead of the hardcoded "DEAL OF / THE WEEK!" and boilerplate copy
- [x] 7.5 Point the section's "Shop Now" link at the campaign rather than the generic `/products`
      <!-- Left pointing at /products. Neither the products page nor the API has
           a campaign filter, so `?campaign=<id>` would have rendered the
           unfiltered catalog under a link promising the deal — worse than the
           honest generic link. Adding that filter is its own change. -->
- [x] 7.6 Replace the homepage's single `getProducts({ limit: 24 })` with four parallel reads via `Promise.all`: featured (`isFeatured=true`), best-selling (`sortBy=totalSold`), new arrivals (`sortBy=createdAt`), and the `DEAL_OF_WEEK` campaign
- [x] 7.7 Delete the four in-memory slices — `products.slice(0, 6)`, the `isFeatured` sort, `[...products].reverse()`, and the `compareAtPrice` filter. `reverse()` was never "newest": the newest products may not be in the fetched page at all
- [x] 7.8 Omit each section when its query returns empty, and omit `DealOfWeek` entirely when no campaign occupies the slot — no fallback to "any product with a compareAtPrice", which would put a countdown next to products that are not on a deadline (design.md Decision 7)
- [x] 7.9 Verify the "Best Selling Products" tabs still work — `ProductSection` currently receives `categoryTabs`, and that interaction must survive the products behind it changing source
      <!-- `ProductSection` accepts a `tabs` prop but never renders it — the
           heading row has no tab strip. Pre-existing and unrelated to this
           change; the `categoryTabs` pass-through still compiles and behaves
           exactly as before. -->
- [x] 7.10 Verify against the target UI: the deal row shows discount badges, struck-through prices, and a countdown that survives a page reload instead of restarting at 7 days

## 8. Verification

- [x] 8.1 Run `tsc` across both repos. Section 5.10's derived types and 7.1's required prop are both designed to surface breakage here rather than at runtime
- [x] 8.2 Confirm every storefront product request uses only allowlisted `sortBy` values — this is the compatibility claim that lets the backend deploy before the frontend (design.md Migration Plan)
- [x] 8.3 Walk the catalog spec scenarios: featured-only listing excludes `DRAFT`/`ARCHIVED`; units-sold ordering puts never-sold products last at 0; an unpaid order does not count; payment success increments; refund decrements; the counter never goes negative
- [x] 8.4 Walk the marketing spec scenarios: slot occupied, slot empty, scheduled, expired, no `endsAt`, unknown placement, paused-only, and two campaigns in one slot
- [x] 8.5 Seed a `DEAL_OF_WEEK` campaign with five discounted products and a real `endsAt`, then confirm the homepage renders the target UI and that the countdown continues — rather than resetting — across a reload
- [x] 8.6 Confirm each section degrades independently: with no featured products, no sales, and no campaign, the homepage renders a shorter page with no empty grids and no error
- [x] 8.7 Add Postman requests for `GET /campaigns/active?placement=DEAL_OF_WEEK`, the featured/best-selling/new-arrival product listings, and the rejected `sortBy=costPrice` case; update `postman_structure.txt`
