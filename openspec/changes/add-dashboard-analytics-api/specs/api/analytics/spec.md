## Purpose

Exposes read-only, computed reporting data (KPIs, trends, time series, recent activity) over existing order/customer/product data for the admin dashboard — no persisted analytics data of its own.

## ADDED Requirements

### Requirement: Dashboard summary is admin/staff-only and computed live
An authenticated OWNER/ADMIN/STAFF SHALL be able to fetch a dashboard summary; no unauthenticated or customer-role request SHALL be able to reach it.

#### Scenario: Customer requests the dashboard summary
- **WHEN** a customer-role request calls the dashboard summary endpoint
- **THEN** the response is 403

#### Scenario: Staff requests the dashboard summary
- **WHEN** an OWNER, ADMIN, or STAFF request calls the dashboard summary endpoint
- **THEN** the response includes KPIs, a time series, recent orders, and low-stock products

### Requirement: KPI trends compare the requested window to the immediately preceding window of equal length
Revenue and order-count KPIs SHALL be computed for the requested date range and SHALL include a percentage change against the same-length period immediately before it, excluding `CANCELLED` orders from both.

#### Scenario: Revenue trend calculation
- **WHEN** the dashboard summary is requested for the last 30 days
- **THEN** the revenue figure covers orders from the last 30 days (excluding cancelled), and its trend is the percentage change versus the 30 days before that

### Requirement: Low-stock reporting has no fabricated trend
The low-stock product count SHALL reflect current inventory only; the response SHALL NOT include a trend value for it, since stock thresholds aren't a time-series field in the schema.

#### Scenario: Low-stock count in the summary
- **WHEN** the dashboard summary is requested
- **THEN** the low-stock count reflects products currently at or below their low-stock threshold (and above zero), with no accompanying trend figure
