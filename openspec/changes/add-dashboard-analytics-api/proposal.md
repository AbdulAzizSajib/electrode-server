## Why

The admin panel's dashboard (`admin/src/lib/api/dashboard.ts`) is still a mock: it fabricates revenue/order/customer KPIs, synthetic time-series points, and low-stock data by reading other mock modules' in-memory arrays. There is no backend endpoint for any of this — no `Dashboard` model was ever implied by the schema because a dashboard isn't a persisted resource, it's a computed summary over `Order`, `Customer`, and `Product`. The admin's mock-to-real migration roadmap has reached the point where this is the only remaining screen with nothing real to call.

## What Changes

- Add a new `api/analytics` capability: one admin/staff-only endpoint, `GET /analytics/dashboard`, that computes real KPIs, a daily revenue/order series, recent orders, and low-stock products directly from `Order`, `Customer`, and `Product` — no new persisted model, no schema migration.
- Accepts a `range` query param (`7d | 30d | 90d`, default `30d`) controlling both the time-series window and the KPI/trend comparison window.
- KPIs: total revenue and order count within the window (excluding `CANCELLED` orders), each compared against the immediately preceding window of the same length for a real percentage trend (replacing the mock's hardcoded trend numbers like `8.4`); total customer count (all-time, not window-scoped — matches what "how many customers do we have" means); current low-stock product count (a live snapshot, not window-scoped — stock levels aren't a time series in this schema, so there's no trend to compute for it, and the response doesn't pretend to have one).
- Time series: daily revenue and order-count buckets across the window, computed in application code from the same order query the KPIs use (no raw SQL, no date-trunc — the codebase has no precedent for either and the data volumes here don't need them).
- Recent orders: the 5 most recently created orders (any status), with customer name and total.
- Low-stock products: up to 5 products where `0 < stockQuantity <= lowStockThreshold`, ordered by how close they are to zero.

## Capabilities

### New Capabilities
- `api/analytics`: read-only, admin/staff-only reporting endpoint(s) computed over existing order/customer/product data — starting with the single dashboard-summary endpoint this change adds.

### Modified Capabilities
(none — no existing endpoint's behavior changes)

## Impact

- **Affected code**: new `src/app/module/analytics/` (route/controller/service/interface, following the existing module convention — no `validation.ts` needed, the only input is an optional `range` query param the service whitelists itself, not a request body), one new `router.use('/analytics', AnalyticsRoutes)` line in `src/app/routes/index.ts`.
- **No schema change**: purely computed from existing `Order`, `Customer`, `Product` tables — no migration.
- **Downstream**: once implemented, `admin/src/lib/api/dashboard.ts` swaps its mock for a call to this endpoint (tracked as a separate admin-side change, mirroring how every other mock-to-real swap in the admin roadmap has been a distinct change from the backend endpoint work it depends on).
