## 1. Hosting viability — blocking, verification only

These answer whether the plan is buildable on the target runtime. None is implementation work, and all four can invalidate design decisions, so they come before anything else. See design.md Risks.

- [ ] 1.1 Confirm the target cPanel plan offers **PostgreSQL**, not MySQL only. The schema is Postgres-specific throughout (`@db.Decimal`, Json columns, `uuid(7)`). A negative answer changes either the hosting or the database, and both are larger than this change
- [ ] 1.2 Confirm a **wildcard certificate** for `*.<domain>` is obtainable. cPanel AutoSSL validates over HTTP and generally cannot issue one; a wildcard needs DNS-01. A negative answer means a manual subdomain + certificate step per merchant, which is compatible with manual billing but **not with self-serve signup** — record which of the three options in design.md applies
- [ ] 1.3 Record the plan's limits — RAM, entry processes, concurrent Node apps, CPU allowance, **inode quota** — against what two long-lived Node processes plus Postgres plus a per-tenant `.next/cache` will consume
- [ ] 1.4 Decide the sequencing against the hosting move, and write the answer into this file. design.md recommends moving hosts while still single-tenant, then running this migration on the settled runtime

## 2. Preflight

- [ ] 2.1 Confirm `DIRECT_DATABASE_URL` is set and `npx prisma migrate status` runs clean. On Neon this exists because the migration engine cannot negotiate `channel_binding=require` and fails with a misleading `P1001`; on the cPanel Postgres it needs re-verifying rather than assuming, since the reason it was needed no longer applies
- [ ] 2.2 Take a full production backup and verify it restores into a scratch database (rollback for this change is restore-from-backup, not a down-migration)
- [ ] 2.3 Create a copy of the production database to rehearse the migration against
- [ ] 2.4 Record the current baseline: row counts per table, and the output of the existing `verify-*` suite, so post-migration equivalence is checkable rather than assumed
- [ ] 2.5 Record a **performance** baseline before any schema change: p50/p95 for the five heaviest admin list endpoints (including their `COUNT`), the storefront's uncached `/api/*` proxy paths, and login. Without this, section 13's budget has nothing to compare against

## 3. Schema — new models

- [ ] 3.1 Add `prisma/schema/Tenant.prisma`: `id`, `name`, `subdomain` (globally `@unique` — it resolves requests), `status` enum, `createdAt`, `updatedAt`, with a doc-comment stating the tenant-owned vs platform-global rule
- [ ] 3.2 Add `TenantStatus` enum to `prisma/schema/enums.prisma`
- [ ] 3.3 Add `prisma/schema/TenantMembership.prisma`: `userId`, `tenantId`, `roleId`, `createdAt`, `@@unique([userId, tenantId])`, indexes on all three FKs
- [ ] 3.4 Add a doc-comment to `User` in `auth.prisma` recording that this model is deliberately platform-global (better-auth owns its queries; the row is a person) and that no tenant-owned field may be added to it — design.md Decision 4

## 4. Schema — tenant column

- [ ] 4.1 Add `tenantId` + relation + `@@index([tenantId])` to all 57 tenant-owned models, leaving `User`, `Session`, `Account`, `Verification`, `Permission` and `Tenant` untouched
- [ ] 4.2 Add `tenantId` to `Role` and `RolePermission` (merchants define their own staff roles — design.md Decision 5)
- [ ] 4.3 Write `scripts/verify-tenant-columns.ts`: parse `prisma/schema/**` and fail if any model is neither on the platform-global allowlist nor carrying `tenantId`. Run it now — it is the check that proves task 4.1 is complete, and it protects against a future model being added unscoped

## 5. Schema — uniqueness

- [ ] 5.1 Convert `Customer.phone` and `Customer.userId` to `@@unique([tenantId, …])` — the phone one is the highest-risk constraint in the change because guest checkout merges on it
- [ ] 5.2 Convert the slug constraints: `Product.slug`, `category.slug`, `Brand.slug`, `Page.slug`, `BlogPost.slug`, `LandingPage.slug`
- [ ] 5.3 Convert the SKU constraints: `Product.sku`, `ProductVariant.sku`
- [ ] 5.4 Convert the human-readable sequences: `order.orderNumber`, `ReturnRequest.returnNumber`, `PurchaseOrder.purchaseNumber`, `SupportTicket.ticketNumber`
- [ ] 5.5 Convert the name/code constraints: `Coupon.code`, `Tag.name`, `TaxRule.name`, `Attribute.name`, `BundleDeal.name`, `Warehouse.code`, `Font.family`, `Role.name`
- [ ] 5.6 Convert the opaque token constraints: `Cart.guestToken`, `order.idempotencyKey`, and extend the `ProductView` and `Shipment` composites with `tenantId`
- [ ] 5.7 Re-key `StoreSetting`: `tenantId` becomes the unique key, drop the `@default("singleton")` id, and rewrite the model doc-comment — it currently instructs readers never to create a second row
- [ ] 5.8 Remove `User.roleId` and its relation and index
- [ ] 5.9 Run `npm run generate` and record the resulting TypeScript errors as the working list for sections 8–10

## 6. Migration and backfill

- [ ] 6.1 Write the migration in the order design.md Decision 11 requires: add columns nullable → backfill → `NOT NULL`. `NOT NULL` first fails against existing rows; nullable forever makes "unattributed row" representable, which the `api/tenancy` spec forbids
- [ ] 6.2 Backfill step: create tenant #1 from the existing `StoreSetting` singleton (its `storeName` and `siteUrl` seed the tenant's name and subdomain), then stamp every existing row with its id
- [ ] 6.3 Backfill step: create one `TenantMembership` per existing `User` from their current `roleId`, before that column is dropped
- [ ] 6.4 Backfill step: re-point the re-keyed `StoreSetting` row at tenant #1
- [ ] 6.5 Drop and recreate the unique constraints as composites, leading with `tenantId`
- [ ] 6.6 Make the whole migration transactional so a partial failure rolls back whole, and assert zero unattributed rows before the `NOT NULL` step
- [ ] 6.7 Rehearse end to end against the copy from 2.3 and compare against the 2.4 baseline

## 7. Tenant context

- [ ] 7.1 Add `src/app/lib/tenant-context.ts`: an `AsyncLocalStorage` store holding the resolved tenant, with a getter that throws rather than returning undefined — an absent tenant must never read as "no filter"
- [ ] 7.2 Add `middleware/resolveTenant.ts` implementing the per-hop table in design.md Decision 7: `Host` for a direct browser request, a secret-authenticated tenant assertion header for the storefront→API hop, `Origin` for a browser→API call, and the session's `TenantMembership` for admin
- [ ] 7.3 Make an absent or invalid assertion secret **fail the request**, never fall back to `Origin` — a fallback chain is how an authenticated path degrades into an unauthenticated one
- [ ] 7.4 Reject any tenant hint arriving on an unauthenticated hop, and add a test proving a forged header changes nothing (`api/tenancy`: "Caller supplies a tenant identifier")
- [ ] 7.5 Extend admin resolution with the acting-tenant selection for a user holding several memberships
- [ ] 7.6 Mount the middleware ahead of every route in `app/app.ts`

## 8. Central enforcement

- [ ] 8.1 Add the Prisma client extension in `lib/prisma.ts` covering `$allModels.$allOperations`: `where` injection on reads, `data` injection on creates, `where` injection on targeted writes
- [ ] 8.2 Rewrite `findUnique` to `findFirst` where the unique key has become composite
- [ ] 8.3 Exempt the platform-global models from injection, driven by the same allowlist `verify-tenant-columns.ts` uses so the two cannot disagree
- [ ] 8.4 Add `withoutTenantScope()`: the single explicit escape hatch, writing an `AuditLog` row on every call. No endpoint in this change may use it
- [ ] 8.5 Make `QueryBuilder` assert the scope is present rather than re-apply it, and strip any client-supplied tenant field from `filter()` so a query parameter cannot widen or redirect scope
- [ ] 8.6 Verify the extension survives nested writes on the deepest path — order → items → stock movement

## 9. Auth

- [ ] 9.1 Rewrite `checkAuth` to resolve the requester's `TenantMembership` in the resolved tenant and compare `membership.role.name` against the required roles; no membership is unauthorized regardless of roles held elsewhere
- [ ] 9.2 Fold the membership into the **existing** session query's `include` rather than adding a second round trip — `checkAuth` already joins `user.role`, and that join is what the membership replaces
- [ ] 9.3 Apply the same resolution to `optionalAuth`, keeping guests falling through as they do today for cart, checkout and quote
- [ ] 9.4 Replace `RoleId`'s fixed primary keys in `constants/role.constant.ts` with `(tenantId, name)` lookups — the same logical role now has a different row id per tenant. `RoleName` stays as-is
- [ ] 9.5 Rework `utils/seed.ts` from seeding a shop into seeding a tenant: roles, permissions and a settings row, so a newly created tenant is immediately operable (`api/tenancy`: "Creating a tenant yields a usable shop")
- [ ] 9.6 Update every call site that read `user.role` or `user.roleId`, using the 5.9 error list

## 10. Raw queries and singleton call sites

- [ ] 10.1 Audit the 9 files using `$queryRaw`/`$executeRaw` — `backup`, `order`, `product`, `purchase-order`, `report.payments`, `report.purchases`, `report.stock`, `stock`, `storage` services — and give each either a literal tenant predicate or a rewrite through the query builder. The extension cannot see these
- [ ] 10.2 Write `scripts/verify-raw-query-scoping.ts`: fail on a raw query with no tenant predicate, so 10.1 cannot regress silently
- [ ] 10.3 Update the 6 non-generated `"singleton"` call sites — `courier.service.ts`, `font.service.ts`, `facebook-capi.ts`, `integration.service.ts`, `store-setting.constant.ts`, `seed.ts` — to resolve settings by tenant
- [ ] 10.4 Remove the id parameter from the store-settings endpoints entirely, so a cross-tenant settings read is unexpressible rather than merely rejected (design.md Decision 8)

## 11. Module sweep

- [ ] 11.1 Read all 45 modules under `src/app/module/` and confirm each is covered by the extension; list any that hand-build `where` clauses in ways the extension cannot reach
- [ ] 11.2 Make the guest COD abuse counters per-tenant — `maxPendingCodOrdersPerPhone` and `maxGuestOrdersPerIpPerHour` currently count globally, so one shop's traffic would exhaust another's allowance
- [ ] 11.3 Make the guest-checkout customer merge resolve the phone number within the tenant only
- [ ] 11.4 Make per-tenant sequence generation for `orderNumber`, `returnNumber`, `purchaseNumber` and `ticketNumber` so each merchant starts at 1 and no sequence leaks platform volume

## 12. Cache keying, CORS, uploads

- [ ] 12.1 Suffix all twelve cache tags in `utils/revalidate.ts` with the tenant id
- [ ] 12.2 Extend `scripts/verify-revalidate-tags.ts` to assert the scoped form on both sides — server and storefront match only by string and drift is otherwise silent
- [ ] 12.3 Confirm the tenant assertion header reaches the server on **every** storefront server-side read, not just some. Any `apiFetch` call that omits it both fails to resolve and shares a data-cache entry across tenants — design.md Decision 12. The storefront half is the `frontend` companion change; this task is the server-side assertion that an unheadered request is rejected rather than served
- [ ] 12.4 Replace the hardcoded `allowedOrigins` array in `app/app.ts` with a DB-driven origin function, cached in process with a short TTL, keeping the deployed first-party origins hardcoded. `CPANEL-DEPLOY.md` already records that quick view, search suggestions and review lists call the API directly from the browser, so this list is load-bearing for those
- [ ] 12.5 Folder Cloudinary uploads per tenant

## 13. Performance and capacity

- [ ] 13.1 Add an in-process LRU + TTL cache for subdomain→tenant resolution. The server has no cache layer today, so without this every uncached request is an extra round trip; on a long-lived Passenger process the cache persists, which is what makes it worth doing (design.md Decision 13)
- [ ] 13.2 Size the `PrismaPg` pool explicitly — it is currently constructed with no pool configuration at all, taking `pg`'s default. One process now serves every tenant
- [ ] 13.3 `EXPLAIN` the five heaviest list endpoints from 2.5 and confirm the planner uses a leading-`tenantId` index for both the `findMany` and its `COUNT`. Pay particular attention to endpoints that filter or sort through a relation — that is where the join's other side is also an N×-larger shared table
- [ ] 13.4 Re-measure against the 2.5 baseline with two tenants seeded, and record the delta. Treat a regression beyond a stated budget as a blocker, not a note
- [ ] 13.5 Seed a synthetic multi-tenant dataset (e.g. 20 tenants' worth of catalog) and re-run 13.3 — a two-tenant measurement cannot show the shape of the degradation
- [ ] 13.6 Record expected `.next/cache` inode and disk growth per tenant against the quota from 1.3, and decide the monitoring trigger before it becomes real

## 14. Verification

- [ ] 14.1 Write `scripts/verify-tenant-isolation.ts`: seed two tenants, then assert cross-tenant reads return nothing across list endpoints, by-id reads, relation-sorted lists, and the nested order path
- [ ] 14.2 Update the existing 50 `verify-*.ts` scripts to run within a tenant context
- [ ] 14.3 Run the full suite against the rehearsal database and compare with the 2.4 baseline
- [ ] 14.4 Confirm each scenario in `specs/api/tenancy/spec.md` is exercised by a verify script or an explicitly recorded manual check

## 15. Contracts and docs

- [ ] 15.1 Update `postman/Ecom.postman_collection.json` for tenant resolution and the store-settings shape change — the collection is the contract of record and moves with the change, not after it
- [ ] 15.2 Run `npx tsx scripts/verify-postman-routes.ts` and resolve drift in both directions
- [ ] 15.3 Update the root `CLAUDE.md` and `server`-level docs: the singleton `StoreSetting` rule, the role-on-`User` description, and the platform-global model list are all now wrong
- [ ] 15.4 Update `frontend/CPANEL-DEPLOY.md` for the multi-tenant reality — its subdomain and SSL steps are written for one shop, and its CORS note becomes the DB-driven allowlist from 12.4
- [ ] 15.5 Open the companion changes in `admin/` and `frontend/` with the server-side contract they must implement, including the tenant assertion header and its effect on the data-cache key

## 16. Release

- [ ] 16.1 Schedule the maintenance window — zero-downtime is explicitly not attempted, because an expand/contract sequence would leave the tenant boundary half-enforced across deploys
- [ ] 16.2 Run the migration and deploy the server as one unit (the old server cannot run on the new schema, and the new server cannot run on the old)
- [ ] 16.3 Run the verify suite against production and confirm the live shop behaves exactly as the 2.4 baseline recorded
- [ ] 16.4 Confirm the 13.4 performance budget holds in production, not only in rehearsal
- [ ] 16.5 Create a second tenant in production and confirm it sees none of tenant #1's data — the change is not done until this passes
