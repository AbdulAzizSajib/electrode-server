## Context

See `proposal.md` for motivation. Relevant existing conventions this follows:

- Module shape: `route.ts` (Express `Router`, `checkAuth(...)` gating), `controller.ts` (`catchAsync` + `sendResponse`), `service.ts` (Prisma queries), `interface.ts` (payload/response types) — same as every other `src/app/module/*`.
- `sendResponse`'s envelope: `{ success, message, data, meta? }`.
- No existing precedent for raw SQL or Prisma's `$queryRaw`/date-trunc grouping anywhere in the codebase — aggregation is done by fetching rows and reducing in JS (see `CampaignService.getActiveDiscountsForProducts`, `StockService.checkLowStock`). This change follows the same style rather than introducing a new one for a single endpoint.
- `Order.status` values that count as "a real sale" for revenue: everything except `CANCELLED` (matches how `checkout`'s own logic already treats non-cancelled orders as revenue-bearing — no separate "did this get paid" check, since payment status lives on `Payment`, not `Order`, and mixing that in would mean joining every order's payments just for a dashboard estimate).

## Goals / Non-Goals

**Goals:**
- One endpoint, `GET /analytics/dashboard`, gives the admin dashboard everything it currently fakes: KPIs with real trends, a daily time series, recent orders, low-stock products.
- Simple, readable aggregation — a handful of Prisma queries plus JS array reduction, not a query-optimization exercise (per [[keep-api-implementation-simple]], which the user has stated applies to this codebase's admin-facing data work generally, not just the admin repo).

**Non-Goals:**
- No caching/materialized-view layer — dashboard reads are infrequent (admins loading one page), and premature caching would add state to reason about for no measured problem.
- No per-warehouse or per-category breakdown — the mock dashboard never had one; not inventing new UI scope here.
- No historical low-stock trend (Decision below) — would require snapshotting stock levels over time, a real feature, not something to fake with a made-up number.

## Decisions

**1. One query window powers both the KPI trend and the time series.**
`range` (`7d`/`30d`/`90d`) determines `since = now - N days`. The service fetches all non-cancelled orders with `createdAt >= previousSince` (i.e. `since - N days`) in one query, then splits that single result set in JS into "this window" (`createdAt >= since`) and "previous window" (`createdAt < since`) — one `Order.findMany`, not two separate range queries, since the previous window is a strict subset of "fetch 2N days back."

**2. Time series buckets are built by iterating the requested `N` days and summing same-day orders from the already-fetched "this window" set** — `O(orders + days)`, not a query per day. Mirrors the mock's `buildSeries` shape (`{date, value}[]`) so the frontend's existing chart plumbing doesn't need to change shape, just its data source.

**3. Trend formula: `((current - previous) / previous) * 100`, and `0` when `previous` is `0`** (avoids `Infinity`/`NaN` on a fresh store with no prior-period orders) rather than omitting the field — the frontend always gets a number it can render.

**4. Customer count is all-time, not window-scoped** — "how many customers do we have" is a running total, not a per-period figure; matches what the mock's `totalCustomers` already meant (it counted every seeded customer, not new signups in a date range). No trend is computed for it either, for the same reason as low-stock (Non-Goals) — there's no cheap "customers as of N days ago" query without an extra full customer scan filtered by `createdAt`, and this KPI's trend value was purely decorative in the mock anyway (a hardcoded `12.7`).

**5. Low-stock and recent-orders lists are simple, un-paginated top-N reads** (`take: 5`), matching the mock's fixed-length lists — this is a summary widget, not a full list view (those already exist as their own pages/endpoints: `GET /products/admin?status=...`, `GET /orders`).

## Risks / Trade-offs

- **[Risk]** Fetching up to 2N days of orders in one query and reducing in JS is `O(orders)` memory — fine at admin-panel/small-store scale, would need real pagination/aggregation if order volume grows into the tens of thousands within a 180-day window → **Mitigation**: none now; matches Non-Goals (no premature optimization), flag for revisit if it becomes a real problem.
- **[Risk]** No trend for customers/low-stock could read as "incomplete" next to KPIs that do have trends → **Mitigation**: proposal.md and this design are explicit about why (no real time-series basis) rather than fabricating one, and the frontend change (separate) should reflect their absence honestly, not synthesize a number.

## Migration Plan

1. Add `src/app/module/analytics/{analytics.interface,analytics.service,analytics.controller,analytics.route}.ts`.
2. Mount `router.use('/analytics', AnalyticsRoutes)` in `src/app/routes/index.ts`.
3. No schema change, no data migration.
