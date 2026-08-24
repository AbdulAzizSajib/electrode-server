## 1. Interfaces

- [x] 1.1 In `src/app/module/analytics/analytics.interface.ts`, add response types: `ITopProduct` (`productId`, `name`, `quantitySold`, `revenue`), `ICategorySales` (`categoryId`, `categoryName`, `revenue`, `orderItemCount`), `IOrderStatusBreakdown` (record/array of `{status, count}` covering every `OrderStatus`), `IPaymentBreakdown` (`byMethod: {method, count, amount}[]`, `byStatus: {status, count}[]`), `IReturnsRefundsSummary` (`returnsByStatus: {status, count}[]`, `refundsByStatus: {status, count, amount}[]`, `refundRate: number`).

## 2. Service functions

- [x] 2.1 `getTopProducts(range)`: query `prisma.orderItem.findMany` scoped to non-`CANCELLED` orders with `createdAt >= since` (design.md Decision 2), reduce into a `Map<productId, {name, quantitySold, revenue}>`, return sorted by `quantitySold` descending.
- [x] 2.2 `getSalesByCategory(range)`: same base `OrderItem` query shape as 2.1 (independent query, design.md Decision 1), reduce into a `Map<categoryId, {categoryName, revenue, orderItemCount}>` keyed off `product.categoryId`/`product.category.name`, skip items whose product has no `categoryId`, return sorted by `revenue` descending, omitting categories with zero activity.
- [x] 2.3 `getOrderStatusBreakdown(range)`: `prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true })` (design.md Decision 3), then fill in every `OrderStatus` enum value not present in the result with `count: 0`.
- [x] 2.4 `getPaymentBreakdown(range)`: two `prisma.payment.groupBy` calls scoped to `createdAt >= since` — one `by: ['method']` with `_count` and `_sum: { amount }`, one `by: ['status']` with `_count` (design.md Decision 4) — convert summed `Decimal` amounts with `Number(...)`/`round2` (Risk in design.md).
- [x] 2.5 `getReturnsRefunds(range)`: `prisma.returnRequest.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true })`, `prisma.refund.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true, _sum: { amount: true } })`, `prisma.order.count({ where: { createdAt: { gte: since } } })` as the rate denominator, `prisma.refund.findMany({ where: { createdAt: { gte: since } }, select: { orderId: true }, distinct: ['orderId'] })`'s length as the numerator; `refundRate = denominator === 0 ? 0 : numerator / denominator` (design.md Decision 5, spec.md "No orders in the window" scenario).

## 3. Controller and routes

- [x] 3.1 Add controller actions in `analytics.controller.ts` for all five: read/whitelist `req.query.range` (same pattern as the existing `getDashboardSummary` action), call the matching service function, `sendResponse`.
- [x] 3.2 Add routes in `analytics.route.ts`: `GET /top-products`, `GET /sales-by-category`, `GET /order-status-breakdown`, `GET /payment-breakdown`, `GET /returns-refunds`, each under `checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF)` matching the existing `/dashboard` route.

## 4. Verification

- [x] 4.1 Run the backend's typecheck/build/lint: `npx tsc --noEmit`, `npx eslint`, and `npm run build`.
- [x] 4.2 Manually exercised all five endpoints (default, `?range=7d`, `?range=30d`, `?range=90d`) against the running dev server (`npm run dev`) hitting the live configured database, authenticated as the seeded OWNER account — all returned 200 with correctly shaped responses. The store currently has zero orders/payments/returns/refunds, so this also directly exercised the "no orders in window" scenario: `returns-refunds` returned `refundRate: 0`, not `NaN`. Best-sellers/category-sales/status/payment breakdowns were verified structurally (empty arrays / all-zero counts) rather than against non-zero activity, since no order data exists yet — revisit once the store has real orders.
- [x] 4.3 Confirmed: registered a throwaway customer-role account, manually flagged it `emailVerified` (registration email OTP wasn't retrievable in this session) to complete login, hit all five new routes with its session cookie — all five returned 403. Test account and its data were deleted afterward; no lasting change to the database.
