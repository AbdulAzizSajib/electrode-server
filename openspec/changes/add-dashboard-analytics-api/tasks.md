## 1. Analytics module

- [x] 1.1 Create `src/app/module/analytics/analytics.interface.ts`: `IDashboardRange = '7d' | '30d' | '90d'`, `IDashboardSummary` (kpis, revenueSeries, ordersSeries, recentOrders, lowStockProducts) matching design.md's shape.
- [x] 1.2 Create `src/app/module/analytics/analytics.service.ts`:
  - `getDashboardSummary(range: IDashboardRange)`: resolve `since`/`previousSince` from `range` (design.md Decision 1); one `prisma.order.findMany({ where: { status: { not: 'CANCELLED' }, createdAt: { gte: previousSince } }, select: {...} })` for both windows.
  - Compute `totalRevenue`/`totalOrders` for `since..now` and `previousSince..since`, trend via design.md Decision 3.
  - Build `revenueSeries`/`ordersSeries` by iterating each day in the window and summing same-day orders from the already-fetched set (Decision 2).
  - `totalCustomers = prisma.customer.count()` (all-time, Decision 4).
  - `lowStockProducts = prisma.product.findMany({ where: { stockQuantity: { gt: 0 }, status: 'ACTIVE' }, orderBy: { stockQuantity: 'asc' }, take: 5 })`, filtered/compared against each product's own `lowStockThreshold` (Prisma can't compare two columns in a `where` — filter in JS after a reasonably-bounded query, or fetch active products ordered by `stockQuantity` ascending and take the first 5 where `stockQuantity <= lowStockThreshold`).
  - `lowStockCount`: count of products where `0 < stockQuantity <= lowStockThreshold` (same comparison constraint — compute in JS from a `select: {stockQuantity, lowStockThreshold}` query over active products, not a raw SQL column comparison).
  - `recentOrders = prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { customer: { select: { firstName, lastName } } } })`.
- [x] 1.3 Create `src/app/module/analytics/analytics.controller.ts`: `getDashboardSummary` — reads `req.query.range`, whitelists to `7d`/`30d`/`90d` (default `30d`) itself (no `validateRequest` needed for a single whitelisted query param), calls the service, `sendResponse`.
- [x] 1.4 Create `src/app/module/analytics/analytics.route.ts`: `GET /dashboard` under `checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF)`.
- [x] 1.5 Mount `router.use('/analytics', AnalyticsRoutes)` in `src/app/routes/index.ts`.

## 2. Verification

- [x] 2.1 Run the backend's typecheck/build/lint. `npx tsc --noEmit`, `npx eslint`, and the full `npm run build` (`prisma generate && tsc && fix-imports`) all clean.
- [ ] 2.2 Manually exercise `GET /analytics/dashboard?range=30d` against a running instance. **Not done** — no database/running backend instance was available in this environment; verified instead via code review that the Prisma queries match the schema (field/relation names checked against `prisma/schema/*` directly while writing the service).
