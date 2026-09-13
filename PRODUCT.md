# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

[Existing codebase: Express 5 + TypeScript (ESM), Prisma 7 + PostgreSQL (Neon) via a PrismaPg driver adapter, better-auth (session) + app-issued JWT access tokens, zod validation, multer memory-storage uploads to Cloudinary, nodemailer (SMTP) transactional email, node-cron jobs, EJS email templates; deployed to Vercel as a single serverless function (`api.ts`, no local listen). Dev port 5000.]

## Users

No direct human users — it is the shared backend for the other two halves of one product: the admin panel (operations staff: OWNER/ADMIN/STAFF, roles held as DB rows) and the customer storefront (shoppers, guests, and campaign visitors), each talking to the same contract. External actors it integrates with: couriers (Steadfast via the courier adapter), Cloudinary (asset storage), SMTP (email), and the storefront (revalidation pings).

## Product Purpose

The source of truth for a single BD-based electronics/gadgets e-commerce business: it owns every domain — catalog, inventory, sales, marketing, customers, content, SEO, reporting and settings — enforces every business rule transactionally, records an audit log for every mutating write, and serves both the admin and the storefront through one consistent envelope contract (`{ success, message, data, meta? }`).

## Positioning

One backend that both frontends consume through the same contract: money, stock, statuses, and permission are computed here and nowhere else. Its commitment is correctness that neither client can override — a courier provider adapter that cannot reorder orchestration rules, a dual-credential auth boundary, and a single revenue definition shared by dashboard and reports.

## Operating Context

- Bangladesh electronics retail: money is `Decimal(12,2)` computed in cents with BDT presentation, COD plus bKash/Nagad/Rocket payment rails, and Steadfast as the integrated courier (one `ICourierProvider` interface, one adapter per provider).
- Runs as one Vercel serverless function; local boot (`server.ts`) seeds and listens, the deployed entry (`api.ts`) exports the app and never seeds.
- Auth requires both a better-auth `session_token` cookie and an app-issued `accessToken` JWT, role checked twice; the storefront authenticates by forwarded Cookie header, guest-only flows via a `guestToken` cookie.
- Storefront caching is invalidated by backend POSTs to `/api/revalidate` with a shared secret; the route is allow-listed and 503s when unconfigured, and a mutation never blocks on it.

## Capabilities and Constraints

- `StoreSetting` is a singleton row (fixed id `"singleton"`); seven separate admin editors share one partial-PATCH endpoint by sending disjoint key sets, and there will never be a second row.
- Tax is owned per-product by `TaxRule`; there is deliberately no fallback tax rate (a schema comment prohibits reintroducing one).
- Revenue is defined exactly once in `src/app/constants/sales.constant.ts` so dashboard and reports cannot disagree.
- Roles are DB rows mirrored by `src/app/constants/role.constant.ts`, not a Prisma enum.
- Courier routing follows the consignment, never the setting: only dispatch reads `StoreSetting.courierProvider`; reconciliation, webhooks and returns route on `Shipment.courierProvider`. `failed` ≠ `unconfirmed`, and `consignmentId` is unique per provider, so webhook lookups match on `(courierProvider, consignmentId)`.
- Route registration order in `src/app/routes/index.ts` is load-bearing (nested mounts above parents).
- Testing is ~24 hand-rolled `scripts/verify-*.ts` scripts that import services directly (never HTTP) against the real database; there is no test framework, so services must never touch `req`/`res`.
- Every migration after `migrate dev` must have the three `pg_trgm` DROP INDEX lines removed by hand or `ProductService.searchProducts` silently degrades to a sequential scan.

## Evidence on Hand

- `postman/Ecom.postman_collection.json` is the API contract and `scripts/verify-*.ts` exercise it against the live DB.
- Pre-launch: seeded/demo data only; nothing in the database is real customer or order content yet.

## Product Principles

1. The service layer owns every rule, every `AppError`, and every audit write — controllers only translate HTTP, so verify scripts can import services directly.
2. Clients are never trusted with the rules: the server refuses invalid transitions, in-use records (409), and unvalidated JSON-column payloads; the frontends can only offer what the server has already declared acceptable.
3. Courier correctness is orchestration-owned: dedupe, eligibility, batching, consignment persistence and status application live in the service, not in any provider adapter.
4. A build must survive deploy: `scripts/fix-imports.js` is mandatory (ESM extensionless imports die at runtime), and revalidation/credentials being unconfigured must fail loudly rather than silently.
5. Money, stock, and status are computed once here, in cents, and presented consistently in both frontends via shared constants — never reassembled in the client.