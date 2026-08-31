## Context

See proposal.md — Why, for the motivation. The constraints that shape the approach:

**Prisma cannot `orderBy` a relation aggregate.** "Most units sold" is a sum over `OrderItem.quantity`, and there is no way to express that as an `orderBy` on `Product`. This project has already hit this exact wall and already chose an answer: `Product.averageRating` and `Product.reviewCount` are denormalized columns, and the schema comment (`product.prisma:36-42`) says so explicitly — "Stored rather than computed because Prisma cannot orderBy a relation aggregate, so 'sort by rating' would otherwise be impossible." This design follows the precedent rather than inventing a second answer to the same problem.

**The payment lifecycle lives entirely on `Payment.status`.** `Order` has no `paymentStatus` column (`Order.prisma`), and `updateOrderStatus` (`order.service.ts:873`) moves `OrderStatus` without touching payments. So "the sale was paid for" is only ever observable as a `Payment` row reaching `PaymentStatus.PAID`. Guest COD checkout creates that row at placement with `status: PENDING` (`order.service.ts:663-673`), so order placement and payment success are genuinely distinct events — counting at placement would credit sales for parcels never collected.

**There is currently no code path that sets a payment to `PAID` or `REFUNDED` after the fact.** `PaymentService.recordPayment` (`payment.service.ts:34`) creates a `Payment` with whatever status the caller supplies and never updates one. `RefundService.createRefund` (`refund.service.ts:10`) writes a `Refund` row and completes the linked return, but leaves `Payment.status` untouched. This is a gap the change must close, not an existing hook to attach to — see Decision 3.

**`QueryBuilder.sort()` has no field whitelist.** It reads `queryParams.sortBy` and puts it straight into Prisma's `orderBy` (`QueryBuilder.ts:234-273`), including a dotted-path branch for relations. Every caller inherits this, and `getPublicProducts` calls `.sort()` unguarded. `?sortBy=costPrice&sortOrder=desc` therefore orders the public catalog by supplier cost today.

**The campaign router is blanket-authenticated.** `campaign.route.ts` calls `router.use(checkAuth(OWNER, ADMIN))` before declaring any route, so every campaign route is admin-only by construction. A public route cannot simply be added below it.

**The frontend homepage is a single fetch sliced four ways.** `src/app/page.tsx` calls `getProducts({ limit: 24 })` once and derives all four sections from that array in memory. `getProducts` already swallows errors and returns an empty result, and `toProduct` (`services/product.ts:61`) already folds `campaignPrice` into the displayed price with the base price struck through — so campaign pricing renders correctly today; it is only *which* products appear that is wrong.

## Goals / Non-Goals

**Goals:**

- Make each of the four homepage sections a distinct backend query whose result matches the section's title.
- Keep the denormalized counter honest under the transitions that actually occur in this codebase, rather than under a hypothetical order state machine.
- Close the `sortBy` disclosure as part of introducing a sort field, not as a separate change — adding `totalSold` to a sort parameter that accepts any column would be adding a documented door to a wall that has no others.
- Keep every section independently degradable: one empty or failing query hides one section, never the page.

**Non-Goals:**

- A general-purpose sort allowlist in `QueryBuilder`. This design fixes the public product listing specifically (Decision 5); other public listings are out of scope and are not audited here.
- Real-time or scheduled recomputation of `totalSold`. The counter is maintained transactionally at the transition, with a one-off backfill for history. A periodic reconciliation job is not part of this change.
- Time-windowed best sellers ("best selling this month"). `totalSold` is lifetime. A windowed variant needs a different data shape and is not required by the homepage.
- Admin UI for setting a campaign's placement (`electrode-admin`). The field is settable through the existing campaign API.
- Making `FLASH_SALE` render anywhere. It exists in the enum so the second placement does not require another migration.

## Decisions

### Decision 1: Denormalize `totalSold` onto `Product` rather than aggregate at query time

**Chosen:** an `Int @default(0)` column on `Product`, indexed, maintained on payment transitions.

**Alternative — aggregate at read time via raw SQL.** The project already uses `$queryRaw` for product search (`product.service.ts:317`), so a `GROUP BY productId` join against `OrderItem` is available. Rejected on two grounds. First, it scales with order history, not catalog size: the homepage's most-viewed query would grow slower every month the store succeeds, and it cannot use an index for the ordering because the sort key is computed. Second, it would need to filter the join on payment status, which means joining `OrderItem → Order → Payment` on every homepage render. The precedent set by `averageRating` — which could equally have been a raw aggregate and deliberately was not — settles it.

**Alternative — a materialized view refreshed periodically.** More machinery than one integer column warrants, and it puts the freshness of "best selling" on a timer for no benefit the homepage can perceive.

The cost of denormalization is that the counter can drift from the underlying orders if a transition is missed. Decision 3 is about making the set of transitions small and explicit; the backfill (Decision 6) doubles as the repair procedure if drift is ever suspected.

### Decision 2: Count at payment success, not at order placement or delivery

**Chosen:** increment when a `Payment` reaches `PaymentStatus.PAID`; decrement when a payment that had been `PAID` moves to `REFUNDED` or `CANCELLED`.

Placement is wrong here specifically because of guest COD: `order.service.ts` creates the COD `Payment` as `PENDING` at checkout, and this store's guest flow is COD-only (`order.service.ts:425`). Counting at placement would count every uncollected COD parcel as a sale — and the codebase already treats unfulfilled COD as a risk worth rate-limiting (`UNFULFILLED_COD_STATUSES`, `order.service.ts:272`), so inflating best-sellers with it would be actively misleading.

Delivery (`OrderStatus.DELIVERED`) was considered and rejected: it lags payment by days, so a genuinely popular new product would not appear in "Best Selling" until the first deliveries land, which is when its popularity matters most.

The decrement condition is *a payment that had been `PAID`* — not any payment reaching `REFUNDED`. A payment refunded from `PENDING` never incremented, and decrementing it would push the counter below the true figure.

**Floor at zero.** The spec requires the figure never go negative. This is not defensive padding: the backfill and the live path can legitimately disagree by one if a refund lands mid-backfill, and a negative count would sort a product to the *top* of an ascending listing. The floor is applied at write time.

### Decision 3: Introduce the payment-status transition the counter hangs on

The counter needs a transition to observe, and the codebase does not currently have one — `recordPayment` only ever creates, and `createRefund` leaves `Payment.status` alone (see Context). So this change must add:

- **A payment status update path.** `recordPayment` creating a `PAID` payment is the increment trigger, and that works today for prepaid orders. But a COD payment created as `PENDING` at placement has no way to become `PAID` — collection currently updates nothing. This change adds that update, which is a real gap independent of merchandising: a COD store cannot presently distinguish a collected parcel from an uncollected one in its payment records.
- **A refund-time decrement.** `createRefund` moves the linked `ReturnRequest` to `COMPLETED` inside its transaction but never marks the payment refunded. The decrement is added to that same transaction.

Both are transitions, so both must be **idempotent by state**: the increment fires only on a transition *into* `PAID` from a non-`PAID` state, and the decrement only on a transition *out of* `PAID`. Recording the same successful payment twice must not double-count. This is why the trigger is expressed as a state transition rather than as "when `recordPayment` is called".

**All counter writes happen inside the same `prisma.$transaction` as the payment write** that triggers them. A payment marked `PAID` in a committed transaction whose counter update failed separately would be silent, permanent drift.

### Decision 4: `Campaign.placement` as a nullable enum, not a slug

**Chosen:** a `CampaignPlacement` enum (`DEAL_OF_WEEK`, `FLASH_SALE`) on a nullable `Campaign.placement`, indexed.

**Alternative — `slug String @unique`.** More flexible: any number of named slots without a migration. Rejected because the flexibility is the failure mode. A slug is a string the frontend must hardcode and the admin must type identically; a typo yields an empty section with no error anywhere — the request is well-formed, it just matches nothing. An enum makes an unknown placement a 400 at the boundary, on both the write and the read. The spec requires exactly that.

This also matches the pattern the project already chose for the structurally identical problem: `BannerPlacement` addresses hero slots as an enum, and `add-hero-banner-placements` extended it by adding values. A second slot-addressing mechanism with different failure semantics would be gratuitous divergence.

**Nullable, not defaulted.** A placement is opt-in — most campaigns are ordinary discounts. A non-null default would silently enroll every existing and future campaign into a homepage slot.

**Not `@unique`.** Uniqueness on `placement` would forbid a scheduled successor campaign from existing while the current one runs, which is the normal way to prepare next week's deal. Instead the spec defines a resolution rule — most recent `startsAt` wins — and the read applies it. This means a misconfiguration (two active campaigns in one slot) degrades to "the newer one shows" rather than to a write error at an unrelated time.

**Eligibility reuses the existing predicate.** The `ACTIVE` + `startsAt`/`endsAt` window filter is exactly the one in `getActiveDiscountsForProducts` (`campaign.service.ts:98-110`). The public read must use the same rule, or a campaign could be served into the slot while its discounts are not applying — the countdown would run on a campaign whose prices are not discounted. The two must not drift; the predicate is extracted so there is one copy.

### Decision 5: Restrict `sortBy` at the product service, not in `QueryBuilder`

**Chosen:** the public product listing validates `sortBy` against an allowlist (`createdAt`, `price`, `name`, `averageRating`, `totalSold`) before calling `.sort()`, and rejects anything else with a 400.

**Alternative — add allowlist support to `QueryBuilder` itself.** Cleaner in principle and the right long-term shape, but `QueryBuilder` is used by every module in the codebase; giving it a new option that defaults to permissive fixes nothing on its own, and making it default to restrictive would silently break sorts across modules this change has not audited. A change about the homepage should not quietly alter every admin listing's behavior.

**Rejected: dropping an invalid `sortBy` and falling back to the default.** It returns 200 with results in an order the caller did not ask for and cannot detect. The spec mandates a 400 for this reason.

The allowlist contains only columns already present in the public product payload, so the rule is checkable by inspection: if a shopper can see the value, they may order by it.

This is the change's one **BREAKING** element, scoped to the public listing. The admin listing keeps its unrestricted sort — an admin is already entitled to every column, and restricting it would break admin tooling for no security gain.

### Decision 6: Backfill `totalSold` as an explicit, reviewable step

The migration defaults every product to 0. Without a backfill, "Best Selling" ranks by post-deploy sales only — on a store with history, that is arbitrary for weeks.

The backfill sums `OrderItem.quantity` grouped by `productId` over orders having a `PAID` payment, applying the same predicate as the live path. It is a **separate, idempotent script** (absolute `SET`, not `+=`), not a `.sql` step inside the migration: it is a data decision an operator should be able to inspect, run, verify, and re-run. Being idempotent, it also serves as the drift-repair procedure referenced in Decision 1.

`OrderItem` stores its own `productId`, so the backfill does not depend on products still existing in their original state.

### Decision 7: Four parallel fetches on the homepage, each section independently omitted

**Chosen:** `Promise.all` of four reads — featured, best-selling, new arrivals, and the deal campaign — replacing the single 24-product fetch.

The current design is not merely inaccurate, it is unfixable in place: `[...products].reverse()` cannot become "newest products" no matter how the array is sliced, because the newest products may not be in the fetched page at all. Each section needs its own query with its own ordering and limit.

Four parallel requests replace one, but each returns ~6 products instead of 24, and they are concurrent — so the wall-clock cost is one round trip, and the total payload is smaller than today's. `getProducts` already returns an empty result rather than throwing (`services/product.ts:142`), so `Promise.all` cannot reject on a failed section; it yields an empty list, and the section is omitted.

**The deal section is omitted entirely when the slot is empty** rather than falling back to today's "any product with a `compareAtPrice`". A fallback would put a countdown next to products that are not on a deadline, which is exactly the fiction this change exists to remove.

### Decision 8: `CountdownTimer` takes a real deadline and expires

`CountdownTimer` currently computes its own target from `daysFromNow = 7` inside `useState`, so it restarts on every mount and never reaches zero. It changes to accept the campaign's `endsAt`.

The existing signature is `{ daysFromNow = 7 }` with a default, so every current call site compiles unchanged while rendering a fake countdown. Making the deadline a **required** prop is deliberate: it converts every remaining fake countdown into a compile error rather than leaving one silently in place.

When the deadline has passed the component renders nothing, and `DealOfWeek` treats an expired campaign as an empty slot. The backend already excludes expired campaigns, so this only covers the window between a page render and the campaign expiring under a user sitting on the page.

**Hydration:** the target is now a server-provided timestamp rather than a client-computed one, so server and client agree on the deadline. The *remaining time* still differs between render and hydration by definition — the existing component computes remaining time during render, which is a latent hydration mismatch. The rewrite computes it in `useEffect` and renders a stable placeholder on the server pass.

## Risks / Trade-offs

**`totalSold` drifts from the true figure if a payment transition bypasses the hook** → Every write to `Payment.status` must go through the service path that maintains the counter. The transitions are few and are enumerated in Decision 3. The idempotent backfill (Decision 6) is the repair procedure, and can be run at any time to reconcile.

**A direct database write to `Payment.status` — a migration, an admin SQL fix — is invisible to the counter** → Accepted. This is inherent to denormalization and is equally true of `averageRating` today. The backfill script is the answer; the tasks note it as the post-incident step.

**Restricting `sortBy` is breaking for any client sorting the public listing by a now-disallowed field** → The allowlist covers every field the storefront actually requests, verified against `electrode-nextjs` before the change lands. External API consumers, if any exist, would break — this is the deliberate cost of closing the `costPrice` disclosure, and the 400 names the parameter so the failure is self-explanatory rather than mysterious.

**Two campaigns in one slot resolves silently to the newer one** → By design (Decision 4); the alternative is a write-time uniqueness error at an unrelated moment. The risk is an admin not noticing their old campaign stopped showing. Mitigated by the rule being specified rather than incidental — and the older campaign's discounts still apply to its products, so nothing is mispriced.

**`Campaign.placement` is a hand-synced list in three places** — the Prisma enum, the Zod schema, and the frontend's type. `add-hero-banner-placements` hit exactly this and found a *third* copy that broke the build (see its tasks.md 2.1); the fix there was deriving the TypeScript types from the generated Prisma enum instead of hand-writing a union. This change follows that resolution from the start: backend types derive from the Prisma enum, leaving only the Zod schema hand-synced, with a comment saying so.

**Four homepage requests instead of one increases the failure surface** → Each is independently caught and degrades to an omitted section. The page cannot fail as a whole, which is a stronger guarantee than today: currently one failed fetch empties all four sections at once.

**The new public campaign endpoint is unauthenticated and returns a product list** → It returns at most one campaign's tagged products, a set an admin explicitly curated, with no caller-controlled limit — so it is not a catalog-dumping vector the way an uncapped listing would be. It exposes no discount configuration, only resulting prices, which are already public via the product listing.

## Migration Plan

Two additive migrations, deployable independently and in either order; neither rewrites a table.

1. **`Product.totalSold`** — `ADD COLUMN ... INTEGER NOT NULL DEFAULT 0` plus an index. Existing rows take the default. Deploy, then run the backfill (Decision 6) and spot-check a known-selling product against its order history before the frontend section goes live.
2. **`CampaignPlacement` + `Campaign.placement`** — `CREATE TYPE` plus a nullable `ADD COLUMN` and an index. No backfill: no existing campaign occupies a slot until an admin assigns one, and the public read reports the slot empty until then.

**Ordering with the frontend:** backend first. Every new parameter is additive except the `sortBy` restriction, and the current storefront issues no sort outside the allowlist — so the deployed backend is compatible with the un-updated frontend, and the homepage keeps rendering its old sections until its own deploy.

**Rollback:** the frontend reverts independently — the old homepage uses only pre-existing endpoints. On the backend, the `sortBy` allowlist is the only behavioral removal and can be reverted alone. The columns are additive and can be left in place on rollback; dropping them is only necessary if the schema must match an older client, which nothing requires.
