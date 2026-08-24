## Why

`add-dashboard-analytics-api` (implemented, not yet archived) gave the admin dashboard its single summary widget: KPIs, a daily revenue/order series, recent orders, low-stock products. That covers the dashboard's top section only. An industry-standard admin dashboard also needs the reporting views every ecommerce back office has — best-sellers, sales-by-category, order-status/payment-method breakdowns, and a return/refund rate — none of which the current `api/analytics` capability exposes. The schema already has everything these need (`Order`, `OrderItem`, `Payment`, `Category`, `Product`, `Refund`, `ReturnRequest`); this is read-only reporting over existing data, the same shape as the endpoint that shipped before it.

## What Changes

- Extend `api/analytics` with five new admin/staff-only, read-only reporting endpoints under `GET /analytics/*`, each accepting the same `range` (`7d | 30d | 90d`, default `30d`) query param as the existing dashboard summary for consistency:
  - `GET /analytics/top-products`: best-selling products/variants in the window, ranked by quantity sold and by revenue, computed from `OrderItem` joined through non-`CANCELLED` `Order`s.
  - `GET /analytics/sales-by-category`: revenue and order-item count grouped by each product's primary `Category` within the window — the pie/bar-chart breakdown every admin dashboard has next to the revenue trend.
  - `GET /analytics/order-status-breakdown`: count of orders in each `OrderStatus` within the window — the funnel/status donut chart.
  - `GET /analytics/payment-breakdown`: count and amount of payments in the window grouped by `PaymentMethod` and by `PaymentStatus` — payment-method split plus a success/failed/pending view.
  - `GET /analytics/returns-refunds`: return request count by `ReturnStatus`, refund count/amount by `RefundStatus`, and a refund-rate (`refunded orders / total orders` in the window) — the "how much are we losing to returns" figure no other endpoint currently answers.
- No new persisted model, no schema migration — every endpoint is computed live from existing tables, same style as `add-dashboard-analytics-api` (fetch + reduce in JS, no raw SQL/date-trunc).

## Capabilities

### Modified Capabilities
- `api/analytics`: adds five new read-only reporting endpoints (top products, sales by category, order-status breakdown, payment breakdown, returns/refunds) alongside the existing dashboard-summary endpoint. No change to the existing endpoint's behavior.

## Impact

- **Affected code**: `src/app/module/analytics/` — new service functions, controller actions, and routes added alongside the existing `getDashboardSummary` (`analytics.interface.ts`, `analytics.service.ts`, `analytics.controller.ts`, `analytics.route.ts`); no new files, no new module. No change to `src/app/routes/index.ts` (already mounts `/analytics`).
- **No schema change**: purely computed from existing `Order`, `OrderItem`, `Payment`, `Category`, `Product`, `Refund`, `ReturnRequest` tables — no migration.
- **Downstream**: once implemented, the admin panel's dashboard/reports screens swap their remaining mocked charts for these endpoints — tracked as a separate admin-side change, same pattern as the dashboard-summary work.
- **Ordering**: this change is additive to, and independent of, `add-dashboard-analytics-api` — it does not need that change archived first, but both touch `src/app/module/analytics/`, so implementing them in sequence (not in parallel branches) avoids merge conflicts.
