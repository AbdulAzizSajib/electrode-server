## Context

See proposal.md for motivation. Builds directly on `add-dashboard-analytics-api`'s conventions (implemented, in `src/app/module/analytics/`):

- Module shape unchanged: `analytics.route.ts` (Express `Router`, `checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF)`), `analytics.controller.ts` (`catchAsync` + `sendResponse`), `analytics.service.ts` (Prisma queries + JS reduction), `analytics.interface.ts` (payload/response types) — five new functions added to each, no new module.
- No raw SQL / `$queryRaw` / date-trunc grouping — same fetch-then-reduce-in-JS style as `getDashboardSummary`, `CampaignService.getActiveDiscountsForProducts`, `StockService.checkLowStock`.
- "Real sale" definition carried over unchanged: everything except `OrderStatus.CANCELLED` counts as revenue/order activity.
- `range` (`7d`/`30d`/`90d` → `since = now - N days`) resolved the same way as the existing `RANGE_DAYS` map and `since` calculation — reused, not reimplemented, across all five endpoints.

## Goals / Non-Goals

**Goals:**
- Five endpoints, each a focused Prisma query (or two) plus a JS `reduce`/`groupBy`-shaped aggregation, following the existing service's structure closely enough that a reader of one recognizes the others immediately.
- Every endpoint independently callable — no endpoint depends on another's response; the frontend can fetch only the charts it's currently rendering.

**Non-Goals:**
- No CSV/export functionality — these are chart-data endpoints, not report downloads (not in the schema's or the mock dashboard's current scope; a real, separate feature if ever needed).
- No caching layer — same rationale as `add-dashboard-analytics-api`: infrequent admin reads, no measured problem to solve yet.
- No cross-endpoint combined "reports" payload — five endpoints, not one mega-endpoint; keeps each query scoped and each response shape independently versionable.
- No per-warehouse breakdown for any of these (top products, category sales, etc.) — `Stock`/`Warehouse` granularity is out of scope, matching the existing dashboard summary's low-stock reporting, which is also warehouse-agnostic (`Product.stockQuantity`, not `Stock` rows).
- No product-variant-level top-sellers distinction beyond what `OrderItem.variantId`/`productName`/`sku` already snapshot — grouping is by `productId`, matching how the storefront and admin already treat a product as the sellable unit for reporting.

## Decisions

**1. Each endpoint issues its own scoped query rather than sharing one mega-fetch.** Unlike the dashboard summary (which fetches one order set and derives multiple KPIs from it), these five endpoints answer different questions over different tables/joins (`OrderItem`+`Product`+`Category` vs `Payment` vs `ReturnRequest`+`Refund`). Sharing a fetch across them would mean over-fetching for the endpoints that don't need it. Each stays a self-contained Prisma call scoped to `createdAt >= since`.

**2. Top products and sales-by-category both start from `OrderItem`, joined to its `Order` for the cancelled-status filter and window, and to `Product`/`Product.category` for grouping.** One `prisma.orderItem.findMany({ where: { order: { status: { not: CANCELLED }, createdAt: { gte: since } } }, select: { quantity, totalPrice, productId, product: { select: { name, categoryId, category: { select: { name } } } } } })` powers both endpoints' aggregation in JS (`reduce` into a `Map<productId, {qty, revenue}>` for top-products; `Map<categoryId, {revenue, count}>` for sales-by-category) — two independent JS reductions over two independent queries (per Decision 1), each shaped for its own endpoint, not one shared fetch.

**3. Order-status breakdown is a single `groupBy`.** `prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true })` — Prisma's `groupBy` is already used nowhere else in this codebase but is the direct, idiomatic tool for "count rows per enum value" and avoids fetching full rows just to tally a status field. Missing statuses (zero orders) are filled in afterward by iterating the `OrderStatus` enum and defaulting absent keys to 0, per the spec requirement.

**4. Payment breakdown is two `groupBy` calls** — `prisma.payment.groupBy({ by: ['method'], where: { createdAt: { gte: since } }, _count: true, _sum: { amount: true } })` and the same `by: ['status']` — rather than one query with two groupings, since Prisma's `groupBy` groups by one dimension set at a time and method/status are independent breakdowns the spec asks for separately.

**5. Returns/refunds combines three cheap queries: `returnRequest.groupBy({ by: ['status'] })` scoped by `createdAt`, `refund.groupBy({ by: ['status'], _count, _sum: { amount } })` scoped by `createdAt`, and the refund-rate numerator/denominator** — `prisma.order.count({ where: { createdAt: { gte: since } } })` for the denominator, and `prisma.refund.findMany({ where: { createdAt: { gte: since } }, select: { orderId: true }, distinct: ['orderId'] })` (length) for the numerator. Rate is `0` when the denominator is `0`, mirroring the existing `computeTrend` guard against division by zero.

**6. Response shapes are flat arrays/objects of `{label, count, amount?}`-style records**, not the `{date, value}[]` time-series shape from the dashboard summary — these are categorical breakdowns (by product, category, status, method), not time series, so reusing the time-series point type would be a type-shape lie. Each gets its own interface in `analytics.interface.ts`.

## Risks / Trade-offs

- **[Risk]** Top-products and sales-by-category fetch all matching `OrderItem` rows for the window and reduce in JS (same `O(rows)` memory pattern as the existing dashboard summary) → **Mitigation**: none now, consistent with the accepted trade-off in `add-dashboard-analytics-api`; revisit if order-item volume within a 90-day window becomes large.
- **[Risk]** `groupBy` with `_sum` on a `Decimal` field returns a `Decimal`-like value from Prisma that needs explicit `Number(...)` conversion before arithmetic/JSON serialization, same as `totalAmount` handling in the existing service — easy to miss and silently produce a stringified decimal in JSON → **Mitigation**: apply the same `Number(...)`/`round2` treatment already used for `totalRevenue` to every summed amount here.
- **[Risk]** Five new endpoints on one route file/service increases `analytics.service.ts` length substantially → **Mitigation**: acceptable per Non-Goals (still one module, matching the proposal's Impact section); split into multiple files only if a future change adds materially more.

## Migration Plan

1. Add five new exported functions to `analytics.service.ts`: `getTopProducts`, `getSalesByCategory`, `getOrderStatusBreakdown`, `getPaymentBreakdown`, `getReturnsRefunds`.
2. Add corresponding types to `analytics.interface.ts` and controller actions to `analytics.controller.ts`.
3. Add five `GET` routes to `analytics.route.ts`, same `checkAuth` gate as the existing `/dashboard` route.
4. No schema change, no data migration, no change to route mounting (`/analytics` already mounted).
