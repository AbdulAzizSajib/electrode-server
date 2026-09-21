## Why

**This server was built for one shop, and the business has decided to sell it to many.** Merchants will sign up, pick a storefront preset, and run their shop under a subscription. Nothing about that is possible today: there are 62 Prisma models and not one of them carries a tenant column. The string `tenantId` does not appear anywhere in `src/`.

The danger is not that multi-tenancy is missing — it is that adding it *incrementally* is how tenant leaks happen. There are 45 modules, and every list endpoint builds its own `where` clause. Scoping them one service at a time means that for the whole migration window some endpoints are scoped and some are not, with no way to tell which from the outside. One missed `where` clause shows a merchant another merchant's orders, and a platform that does that once is finished.

So isolation gets built **first, centrally, and with nothing else in the change**. No plans, no pricing, no entitlements, no super-admin UI, no signup flow, no storefront presets. Those are the parts everyone wants to build, and every one of them is worthless if the row-level boundary underneath is not airtight. This change ends when a second tenant can exist in the database and provably cannot see the first one's data.

Three decisions are already settled and are inputs here, not open questions:

1. **Convert in place.** `server/`, `admin/` and `frontend/` are modified; the existing live shop becomes tenant #1. No fork.
2. **One global `User` table plus a `TenantMembership` join.** Merchant staff and storefront shoppers stay in one table. One person can own shop A and buy from shop B.
3. **Billing is manual and out of scope.** Plan, subscription and entitlement modelling are a later change.

## What Changes

### Tenant identity: two new models, and role moves off `User`

`Tenant` carries the shop's identity and lifecycle (`subdomain`, `status`, `createdAt`). `TenantMembership` joins `userId` + `tenantId` + `roleId` with a `@@unique([userId, tenantId])`.

**BREAKING: `User.roleId` is removed.** Today `User` holds exactly one role (`roleId String @default("customer")`, FK to `Role`), and `checkAuth` reads it through `include: { user: { include: { role: true } } }`. One global role per user cannot express "OWNER of shop A, CUSTOMER of shop B", so the role moves to the membership row and `checkAuth` resolves it against the request's tenant instead of the user. Every call site that reads `user.role` changes.

`User.email` and `User.contactNumber` stay globally `@unique` — deliberately. They identify the *person* across the platform, which is what makes one account working across shops possible. Per-shop identity is `Customer`, below.

### Tenant-owned models gain `tenantId`, and every global unique becomes per-tenant

57 of the 62 models get a `tenantId` column and an index. Five stay platform-global on purpose: the four better-auth-owned tables (`User`, `Session`, `Account`, `Verification`), because better-auth queries them through its own adapter that application code cannot intercept — and because those rows are a *person*, who spans shops — plus `Permission`, which is the catalog of actions the code implements and is not a merchant's to edit. `Role` and `RolePermission` *are* per-tenant, so a merchant can define their own staff roles. See design.md, Decisions 4 and 5.

The uniqueness changes are the part that silently breaks a second tenant's very first write:

| Model.field | Today | Why it must be per-tenant |
|---|---|---|
| `Customer.phone` | `@unique` | **The dangerous one.** Guest checkout *merges* on this field, so two merchants sharing one shopper record means orders resolving across tenants. The platform's phone-as-identity convention rests on it. |
| `Product.slug`, `Product.sku`, `ProductVariant.sku` | `@unique` | Two shops both selling an iPhone cannot both use `iphone-15` |
| `category.slug`, `Brand.slug`, `Page.slug`, `BlogPost.slug`, `LandingPage.slug` | `@unique` | Same |
| `order.orderNumber`, `ReturnRequest.returnNumber`, `PurchaseOrder.purchaseNumber`, `SupportTicket.ticketNumber` | `@unique` | Merchants expect their own sequence starting at 1, not a shared global counter that leaks platform volume |
| `Coupon.code` | `@unique` | `EID25` must be claimable by every shop |
| `Tag.name`, `TaxRule.name`, `Attribute.name`, `BundleDeal.name`, `Warehouse.code`, `Font.family` | `@unique` | Shop-local vocabulary |
| `Cart.guestToken`, `order.idempotencyKey`, `ProductView.viewerKey` | `@unique` / composite | Opaque per-shop tokens; a collision across tenants is a cross-tenant read |

Each becomes `@@unique([tenantId, <field>])`. `Customer.userId @unique` becomes `@@unique([tenantId, userId])` — the same person is a separate customer record in each shop they buy from, which is correct and is what keeps order history from bleeding across shops.

### **BREAKING: `StoreSetting` stops being a singleton**

`StoreSetting.id` is `@default("singleton")` and its doc-comment says in as many words that a second row must never be created. That model becomes one row per tenant, keyed by `tenantId`. Every `upsert({ where: { id: "singleton" } })` call site changes, and the doc-comment inverts.

This also resolves where a storefront preset will eventually live: `theme`, `homeConfig`, `mainNav`, `footerColumns` and `catalogConfig` already compose the storefront entirely from data, so a vertical ("gadgets shop", "dry foods") is a JSON blob copied into this row — never a second storefront codebase. Presets themselves are out of scope here; this change only makes the row they will be written to exist per tenant.

### Isolation is enforced centrally, not in services

A `tenantId` column that every service must remember to filter on is worse than no column at all, because it looks safe. Enforcement is therefore structural:

- Tenant context lives in an `AsyncLocalStorage` store, populated by middleware once per request.
- A **Prisma client extension** in `src/app/lib/prisma.ts` — the single place the client is constructed — injects `tenantId` into `where` on reads and into `data` on writes, for every model and every operation. A service that forgets is still scoped.
- `QueryBuilder` (which drives *every* list endpoint's search/filter/sort/paginate) asserts the scope is present rather than re-applying it, so a filter arriving as `?tenantId=` from a client cannot override it.
- A single explicit, audited `withoutTenantScope()` escape hatch exists for platform-level reads. It is not used by any endpoint in this change; it exists so the future super-admin surface has one obvious, greppable door instead of services quietly drifting back to unscoped queries. Every call writes an `AuditLog` row.

**Resolution is per hop, and this is deliberate.** A browser reaching the storefront resolves by hostname; the storefront's own server-to-API calls carry a tenant assertion authenticated by a shared secret, because `NEXT_PUBLIC_API_BASE_URL` is inlined at build time and one build serves every shop, so that hop cannot carry the shop's hostname; a browser calling the API directly resolves by `Origin`; and the admin resolves from the **session's `TenantMembership`**. An assertion is honored only on an authenticated hop, and a request that resolves no tenant is rejected, never defaulted. See design.md Decision 7.

That same assertion header is what keeps the storefront's **data cache** correct. Next keys a cached fetch on its URL and headers; without it, every tenant would request an identical URL with identical headers and therefore **share one cache entry** — serving one shop's catalog to another, before the request ever reaches this server. Decision 12.

### Cache tags become tenant-scoped

`src/app/utils/revalidate.ts` fires global strings — `"store-settings"`, `"campaigns"`, `"products"` and the rest. Unchanged, one merchant editing a theme colour would flush **every** merchant's storefront cache, turning a single save into a platform-wide cache stampede. Tags carry the tenant, and `scripts/verify-revalidate-tags.ts` checks the scoped form so the storefront and server cannot drift apart silently.

### Supporting surfaces

- **CORS** moves from the hardcoded `allowedOrigins` array in `app/app.ts` to a DB-driven allowlist, since tenant subdomains are not known at deploy time.
- **Cloudinary** uploads are foldered per tenant.
- **Backfill**: a migration creates tenant #1 from the existing `StoreSetting` singleton and stamps every existing row with its id, so the live shop is unaffected.
- **Postman collection** and the **50 `verify-*.ts` scripts** move with the change, per the project's standing rule that the collection is the contract of record. Two new verify scripts are added: one asserting every model carries `tenantId`, and one asserting cross-tenant reads return nothing.

### Explicitly not in this change

Plans, pricing, entitlements, feature locking, the super-admin panel, signup and onboarding, storefront presets, custom domains, and any billing. `Tenant.status` is modelled but nothing yet gates on it beyond rejecting a request whose tenant cannot be resolved.

## Capabilities

### New Capabilities

- `api/tenancy`: how the platform partitions data between merchants — what a `Tenant` and a `TenantMembership` are, how a request's tenant is resolved (subdomain for the storefront, session membership for the admin) and what happens when it cannot be, the guarantee that isolation is enforced at the data-access layer rather than per service, the single audited escape hatch and its logging obligation, the rule that every uniqueness constraint is tenant-relative unless it identifies a person, per-tenant store settings, and tenant-scoped cache invalidation.

### Modified Capabilities

- `api/support-and-admin`: **"Store settings are singleton-safe through the API too"** is directly contradicted — the requirement currently states the API "SHALL always operate on the one `StoreSetting` row (fixed id `"singleton"`)" and "SHALL NOT expose any way to create a second row". It becomes one row per tenant, resolved from request context and never addressable by a caller-supplied id. **"Only OWNER can manage roles and permissions"** also changes: OWNER is now a role *within a tenant*, so the requirement scopes to that tenant's membership rows.
- `api/checkout`: **"A customer can only see their own orders; staff can see all"** — "all" is no longer true and is exactly the sentence a leak would hide behind. Staff see every order *in their tenant*. The guest COD abuse caps (`maxPendingCodOrdersPerPhone`, `maxGuestOrdersPerIpPerHour`) also become per-tenant counters, so one shop's traffic cannot exhaust another's allowance.
- `api/catalog`: **"Category and brand slugs are stable, unique lookup keys"** — slug lookup becomes unique *within a tenant*, and the public `GET /products/{slug}` resolution is relative to the resolved shop.
- `api/cart-wishlist`: **"A guest can build a cart without an account"** and **"A guest cart merges into the customer cart on login"** — the issued `guestToken` is tenant-scoped, and the login-time merge resolves the customer within the tenant rather than globally by phone.
- `api/inventory`: **"Only OWNER/ADMIN/STAFF can access inventory endpoints"** — the role is read from the requester's `TenantMembership` for the resolved tenant, not from `User.roleId`.

## Impact

**Schema.** 57 of the 62 models in `prisma/schema/` gain `tenantId`; two new model files (`Tenant.prisma`, `TenantMembership.prisma`); ~20 unique constraints converted to composites; `User.roleId` dropped; `StoreSetting` re-keyed. One migration with a backfill, which must run with the live shop's data in place.

**Auth.** `middleware/checkAuth.ts` and `optionalAuth` both change shape — they resolve a tenant and read the role from a membership. better-auth session handling is touched. `utils/seed.ts` moves from seeding a shop to seeding a tenant.

**Data access.** `lib/prisma.ts` (client extension), `utils/QueryBuilder.ts` (scope assertion), new `lib/tenant-context.ts`.

**Every module.** All 45 modules under `src/app/module/` are read to confirm the extension covers them; services that hand-build `where` clauses or use raw queries need individual review.

**Other apps.** `admin` sends no tenant hint today and its `BASE_URL` is hardcoded in `lib/api/client.ts`; `frontend` resolves no tenant from its hostname, its `proxyRequest` forwards no tenant assertion, and `apiFetch` sends every tenant's read to one build-time-fixed origin. Both need companion changes — tracked separately, and this change lands first.

**Runtime.** The platform is moving from Vercel to cPanel shared hosting, for the server and database as well as the storefront that is already there (`frontend/CPANEL-DEPLOY.md`). That move is not part of this change, but it is the runtime this change is designed for, and it decides three things the design turns on: an in-process cache and a single stable connection pool become viable, while wildcard TLS for tenant subdomains, PostgreSQL availability and the host's inode quota become open risks. Tasks section 1 verifies all three **before** any code is written, because a negative answer on either of the first two changes the plan rather than the schedule.

**Contracts.** `postman/Ecom.postman_collection.json`, `scripts/verify-postman-routes.ts`, `scripts/verify-revalidate-tags.ts`, and the remaining 48 `verify-*.ts` scripts, all of which currently assume one shop.
