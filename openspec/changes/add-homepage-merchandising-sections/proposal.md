## Why

The storefront homepage renders four merchandising sections — Best Selling Products, Featured Products, Deal of the Week, and New Arrivals — but none of them is real. `src/app/page.tsx` makes a single `getProducts({ limit: 24 })` call and then slices that one array four ways in the browser: "Best Selling" is `products.slice(0, 6)` (the first six of an arbitrary page), "New Arrivals" is `[...products].reverse().slice(0, 6)` (the *reverse* of one page, not the newest products in the catalog), and "Deal of the Week" is `products.filter((p) => p.compareAtPrice)` — any product with a struck-through price, unrelated to any campaign. `DealOfWeek.tsx` renders `<CountdownTimer />` with no props, so it counts down from `daysFromNow = 7` computed at mount: the timer restarts on every page load and expires on no real date.

Three of the four sections cannot be made real without new backend capability. Featured is the exception — `Product.isFeatured` exists and is indexed, but `getPublicProducts` does not read the parameter, so the public API offers no way to ask for featured products. Best Selling has no backing data at all: Prisma cannot `orderBy` a relation aggregate, so "most units sold" is not expressible against `OrderItem` — the same constraint that already forced `averageRating`/`reviewCount` to be denormalized onto `Product`. Deal of the Week has the data (`Campaign` + `CampaignProduct` carry the window and the discount) but no way to address it: `Campaign` has no stable identifier for "the campaign that belongs in this homepage slot", and every campaign route sits behind `checkAuth(OWNER, ADMIN)`, so the storefront cannot read one at all.

## What Changes

**Backend — `electrode-server`**

- Add `Product.totalSold Int @default(0)`, indexed, denormalized. Maintained on payment state transitions, not on order placement: incremented when an order's payment reaches `PAID`, decremented when it moves to `REFUNDED`/`CANCELLED`. Guest COD orders create a `Payment` row with `status: PENDING` at checkout (`order.service.ts:663-673`), so counting at placement would credit sales for parcels that are never paid for.
- Add a `CampaignPlacement` enum (`DEAL_OF_WEEK`, `FLASH_SALE`) and a nullable, indexed `Campaign.placement`. Nullable because most campaigns are ordinary discounts that belong in no homepage slot; a placement is opt-in.
- Add `GET /campaigns/active` — the first public campaign endpoint. Accepts `?placement=`, returns the campaign's `name`, `description`, `endsAt` and its products with campaign pricing already applied. `endsAt` is what makes the countdown real.
- Widen `getPublicProducts` to accept `isFeatured` and to sort by `totalSold`. The sort is the reason this is not purely additive: `QueryBuilder.sort()` (`QueryBuilder.ts:234-273`) passes `sortBy` into Prisma's `orderBy` with **no whitelist**, so `?sortBy=costPrice&sortOrder=desc` on the public endpoint currently orders the catalog by supplier cost and leaks the margin ranking of every product to an anonymous caller. Introducing a documented sort field means specifying which fields are sortable; this change adds an allowlist to the public product listing.
- **BREAKING (public product listing only):** `?sortBy=` on `GET /products` is restricted to an allowlist (`createdAt`, `price`, `name`, `averageRating`, `totalSold`). A request naming any other field is rejected with 400 rather than silently ordering by it. The admin listing is unaffected. This closes the disclosure above; no storefront request in `electrode-nextjs` uses a field outside the allowlist.

**Frontend — `electrode-nextjs`**

- Replace the one-fetch-four-slices homepage with four independent, parallel reads (`Promise.all`), each asking the API for what the section actually means.
- `CountdownTimer` takes a real `endsAt` and renders nothing once the deadline passes, instead of restarting a fake seven-day countdown on every mount.
- `DealOfWeek` renders the campaign's own name and description; the whole section is omitted when no campaign occupies the slot, rather than falling back to "any product with a compareAtPrice".
- Each section is omitted when its query returns empty, so an unseeded catalog degrades to a shorter page rather than an empty grid.

## Capabilities

### New Capabilities

*(none — both affected capabilities already exist)*

### Modified Capabilities

- `api/catalog`: The public product listing gains two requirements. It SHALL support retrieving products by merchandising intent — featured products, and products ordered by units sold — so a storefront section means what its title says. It SHALL also constrain `sortBy` to an allowlist, so ordering the public catalog cannot reveal a non-public column.
- `api/marketing`: Campaigns gain an addressable homepage placement, and the public gains a read path to one. Today a campaign's discount surfaces only implicitly, attached to product prices; a storefront cannot ask "which campaign is running, and when does it end?" — which is precisely what a countdown needs.

## Impact

**Database (2 migrations, both additive):**
- `Product.totalSold` — new `INTEGER NOT NULL DEFAULT 0` column plus index. Existing rows default to 0. A backfill from historical `PAID` orders is included as an explicit, separately-reviewable step; without it every product starts at zero and "Best Selling" is arbitrary until sales accumulate.
- `CampaignPlacement` enum + `Campaign.placement` nullable column plus index. `CREATE TYPE` and a nullable `ADD COLUMN` — no table rewrite, no backfill.

**Backend modules:**
- `prisma/schema/product.prisma`, `Campaign.prisma`, `enums.prisma`
- `product.service.ts` — `getPublicProducts` filter + sort allowlist; `product.validation.ts` — public query schema
- `campaign.service.ts` / `.controller.ts` / `.route.ts` — public `getActiveCampaign`; the router's blanket `router.use(checkAuth(...))` must be narrowed so one route can sit outside it
- `payment.service.ts` — the `totalSold` transition hook. `recordPayment` currently writes a `Payment` row and notifies; it does not touch `Order.status`, and `Order` has no `paymentStatus` column, so the payment lifecycle is carried entirely by `Payment.status`. This is where the counter is maintained, inside the existing write.

**Frontend:** `src/app/page.tsx`, `components/home/DealOfWeek.tsx`, `components/ui/CountdownTimer.tsx`, `services/product.ts`, new `services/campaign.ts`, `types/` additions.

**Not in scope:** the admin UI (`electrode-admin`) for setting a campaign's placement — the field is settable via the existing campaign API, and the admin form is a separate consumer. `FLASH_SALE` is defined in the enum but no homepage section consumes it; it exists so the second placement does not require another migration.

**Postman:** new requests for `GET /campaigns/active`, and featured/best-selling/new-arrival examples on the public product listing.
