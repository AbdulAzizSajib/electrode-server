## Context

See `proposal.md` — Why. The motivation is not repeated here.

What matters for the design is the shape of what exists today:

- **One Prisma client, constructed in exactly one place.** `src/app/lib/prisma.ts` builds a `PrismaClient` over a `PrismaPg` adapter and exports it. Every module imports that instance. This single construction point is the whole reason a central enforcement scheme is affordable.
- **One query surface for lists.** `utils/QueryBuilder.ts` drives search/filter/sort/paginate for every list endpoint over a Prisma delegate, including dotted relation fields.
- **62 models across 56 schema files**, none with a tenant column.
- **`User` holds one role**, `roleId String @default("customer")` with an FK to `Role`, and `checkAuth` reads it through `include: { user: { include: { role: true } } }`.
- **better-auth owns four tables** — `user`, `session`, `account`, `verification` (mapped via `@@map`). better-auth issues its own queries against them through its own adapter, which does not pass through application code.
- **`StoreSetting` is a singleton** keyed `id @default("singleton")`.
- **Migrations run against `DIRECT_DATABASE_URL`** because Prisma's migration engine cannot negotiate Neon's `channel_binding=require` and reports a misleading `P1001`.
- **Every list endpoint runs a `COUNT`.** `QueryBuilder.execute()` is `Promise.all([count, findMany])`, so each list page is two queries, both of which gain the tenant predicate.
- **The server has no cache layer at all.** No Redis, no LRU, nothing. Any per-request lookup this change introduces is a database round trip unless a cache is introduced alongside it.
- **The storefront's server-side reads all go to one origin.** `apiFetch` builds `${API_BASE_URL}${path}`, and `API_BASE_URL` comes from `NEXT_PUBLIC_API_BASE_URL`, which Next inlines **at build time**. It cannot vary per request. See Decision 7.

**Target runtime: cPanel shared hosting, not Vercel.** `frontend/CPANEL-DEPLOY.md` already documents the storefront running under cPanel's Setup Node.js App (Passenger, Node 22) from a locally-built `output: "standalone"` bundle — because `next build` on the shared host is killed by RAM and process limits. The server and the database are to follow onto the same account. The `vercel.json` in this repo and the Neon-specific notes above describe where the platform is *today*, not where it is going, and several decisions below turn on the difference.

## Goals / Non-Goals

**Goals**

- One enforcement point that a service cannot accidentally bypass.
- A tenant boundary that is verifiable by a script rather than by reading 45 modules.
- A migration that leaves the live shop's observable behavior identical.
- An escape hatch that exists, is greppable, and is audited — designed now so the future super-admin surface does not invent its own.

**Non-Goals**

- Physical isolation (separate database or schema per tenant). Rejected below.
- Postgres row-level security. Considered and deferred, not rejected — see Decision 3.
- Per-tenant connection pooling, rate limiting or noisy-neighbour controls. Real concerns, but they are capacity work, not correctness work, and are not on the path to a provable boundary.
- Any admin or storefront UI. The companion changes in `admin/` and `frontend/` follow this one.

## Decisions

### Decision 1: One database, `tenantId` column, shared tables

**Chosen:** a single Postgres database with a `tenantId` discriminator column on tenant-owned tables.

*Alternatives considered:*

- **Database per tenant.** The strongest isolation available and the obvious answer if isolation were the only concern. Rejected on operational cost: the Prisma schema is split across 56 files and migrations already need a special connection string to run at all. Each new merchant would mean provisioning a database and running a migration, and each schema change would mean running it N times with partial-failure states to reconcile. On Neon, N databases also means N connection pools from a serverless runtime that is already latency-sensitive.
- **Schema per tenant.** Same migration-fan-out problem with weaker isolation and worse Prisma support.
- **Shared tables with `tenantId`.** One migration, one pool, one schema. Isolation becomes a software property rather than an infrastructure one — which is the trade, and is why Decisions 2 and 3 exist.

The door is not closed: a large merchant can later be moved to their own database without changing application code, because every query is already tenant-qualified.

### Decision 2: Enforcement by Prisma client extension over `AsyncLocalStorage`, not per-service `where` clauses

**Chosen:** an `AsyncLocalStorage` store holds the resolved tenant for the request; a Prisma client extension applied in `lib/prisma.ts` injects the scope into every operation on every model.

The extension intercepts `$allModels.$allOperations`:

- **Reads** (`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `groupBy`) get `tenantId` merged into `where`.
- **Writes** (`create`, `createMany`) get `tenantId` merged into `data`.
- **Targeted writes** (`update`, `updateMany`, `delete`, `deleteMany`, `upsert`) get it merged into `where`, so an update addressed at another tenant's row matches nothing rather than succeeding.
- **`findUnique` on a now-composite key** is rewritten to `findFirst` where the unique key alone no longer identifies a row.

*Alternative considered — per-service `where` clauses.* This is what "just add tenantId" means in practice and it is the standard way this goes wrong. 45 modules, each writing its own conditions, means the boundary holds only where someone remembered. There is no test that proves the negative, and the failure is silent: the endpoint returns data, the merchant reading it cannot tell it is not theirs, and the merchant whose data it is never finds out. Rejected.

*Why `AsyncLocalStorage` and not a request-scoped client.* Constructing a client per request would be cleaner in principle, but Prisma clients hold pooled connections; one per request on a serverless runtime is how a connection pool gets exhausted. `AsyncLocalStorage` keeps one client and carries the context through the async call chain instead.

**Known gap, accepted and mitigated:** an extension cannot intercept `$queryRaw`/`$executeRaw`, and it cannot fully reason about deeply nested writes. Both are handled in Risks.

### Decision 3: Postgres RLS is deferred, not adopted

RLS would move the boundary into the database, where no application bug can cross it — genuinely stronger than Decision 2.

Deferred because it needs a per-request `SET LOCAL` of a session variable on the same pooled connection that Prisma then uses, which is awkward through the `PrismaPg` adapter and fragile under connection pooling. Adopting it as part of a migration this large would mean debugging two unfamiliar mechanisms at once, and a half-working RLS policy is more dangerous than none because it invites the assumption that the database is covering for the application.

The extension is designed so RLS can be layered underneath later without touching a single service: it would become a second, redundant boundary rather than a replacement.

### Decision 4: Not every model gets `tenantId`

**This corrects the proposal's shorthand of "all 62 models".** Three groups stay platform-global:

| Table(s) | Global because |
|---|---|
| `User`, `Session`, `Account`, `Verification` | better-auth issues its own queries against these through its own adapter, which does not pass through the extension. Adding a tenant column here would produce a boundary that is enforced on some queries and not others — the worst of both. It is also the right model: these rows are a **person**, and a person spans shops. |
| `Permission` | The catalog of actions the software supports. Defined by the code, not by a merchant. |
| `Tenant` | Is the tenant. |

Everything else is tenant-owned, including `Role` and `RolePermission` — see Decision 5.

The `api/tenancy` spec's uniqueness requirement is written in exactly these terms: tenant-relative unless it identifies a person.

### Decision 5: `Role` is per-tenant; `Permission` is global

A merchant will want staff roles of their own ("Delivery Manager", "Content Editor"), and the existing `api/support-and-admin` requirement already says an OWNER manages roles and permissions. Global roles would make that requirement unsatisfiable.

So `Role` and `RolePermission` carry `tenantId` and are seeded per tenant; `Permission` stays global because a merchant cannot invent a new action the code does not implement.

*Consequence:* `RoleId`'s fixed primary keys in `constants/role.constant.ts` (`"owner"`, `"admin"`, …) can no longer be global constants — the same logical role has a different row id per tenant. Lookups move to `(tenantId, name)`. `RoleName` survives unchanged and remains the thing authorization code compares against.

### Decision 6: **BREAKING** — role moves from `User` to `TenantMembership`

```
TenantMembership { userId, tenantId, roleId, createdAt, @@unique([userId, tenantId]) }
```

`User.roleId` is dropped. One global role per user cannot express "OWNER of shop A, CUSTOMER of shop B", which is a first-class case under the one-`User`-table decision.

`checkAuth` changes shape: it resolves the tenant, then loads the requester's membership **in that tenant**, then compares `membership.role.name` against the required roles. No membership means unauthorized — a role held in another tenant is not consulted, which is what the `api/tenancy` spec requires.

*Alternative considered — keep `User.roleId` as a default and layer memberships on top.* Rejected: two sources for the same fact, and the stale one wins whenever someone forgets the new one. This is the same reasoning that removed `defaultTaxRatePercent` from `StoreSetting` in an earlier change.

### Decision 7: Tenant resolution is per-hop, because the storefront cannot forward its own hostname

An earlier draft of this decision said the server always resolves the tenant from the request's `Host`, and that no tenant header is ever trusted. **That is not implementable for the storefront's server-side reads, and the reason is worth stating plainly:** `apiFetch` builds every URL from `API_BASE_URL`, which comes from `NEXT_PUBLIC_API_BASE_URL` — and Next inlines `NEXT_PUBLIC_*` at build time. `CPANEL-DEPLOY.md` documents this constraint already, for a different reason. One build serves every shop, so that origin is fixed, and the `Host` on the storefront→API hop is the API's own hostname. The shop's hostname is not on that request at all.

So resolution is defined per hop, by whatever is trustworthy on that hop:

| Hop | Source | Why it is trustworthy |
|---|---|---|
| Browser → storefront | The request's `Host` | It is what the request was routed on; nothing upstream is asserting it |
| Storefront server → API (`apiFetch`, and the `/api/*` proxy) | A tenant assertion header, authenticated by a shared secret | The storefront has already resolved the tenant from its own `Host`. The secret is what separates it from an arbitrary caller |
| Browser → API directly (RTK Query: quick view, search suggestions, reviews) | The `Origin` header, matched against known tenant subdomains | The browser sets `Origin` and a page cannot forge another site's |
| Admin → API | The session's `TenantMembership` | One SPA serves every merchant; its hostname says nothing about which shop the user is in |

**The rule that survives is the one that mattered:** a tenant assertion is honored only when the hop carrying it is authenticated. An unauthenticated caller sending a tenant header gets it ignored, exactly as before. The shared-secret pattern is not new here — `STOREFRONT_REVALIDATE_SECRET` already authenticates the reverse direction between the same two apps.

**A missing or invalid secret must fail the request, not fall back to `Origin`.** A fallback chain is how an authenticated path quietly degrades into an unauthenticated one.

*Consequence for a multi-shop owner:* a user with memberships in several tenants needs an explicit "acting tenant" on their admin session. Modelled here as a field on the membership lookup; the switcher UI is the `admin` companion change.

### Decision 12: The storefront's data cache is keyed per tenant

This is a correctness decision that presents as a caching detail, which is why it is easy to miss.

Next 16.3.1 computes a fetch's data-cache key in `incremental-cache/index.js` as a hash of `[MAIN_KEY_PREFIX, fetchCacheKeyPrefix, url, method, bodyType, headers, mode, redirect, credentials, …]`. Today every tenant's storefront would request the identical `url` with identical `headers` — a public read carries no cookie — so **every tenant would share one cache entry, and shop A's product list would be served to shop B.** The Prisma extension cannot prevent this, because on a cache hit the request never reaches the server.

`headers` being part of that key is what makes the fix free: the tenant assertion header from Decision 7 varies the key automatically. The two decisions are the same mechanism, and neither works without the other.

*Alternative considered — `fetchCacheKeyPrefix`.* Next exposes it precisely for this, but it is configured per build, and one build serves every shop. Rejected for the same reason `NEXT_PUBLIC_API_BASE_URL` cannot carry the tenant.

*Consequence, and it is not free:* cache entries multiply by tenant count. Each tenant warms its own entries from its own traffic, so a busy shop is unaffected — but a shop with little traffic will find its entries expired more often than not, and will feel slower than the same shop does today as the platform's only tenant. Sharpened caching for low-traffic tenants is deliberately left to a later change; noting it here stops it being discovered as a regression.

### Decision 13: The runtime is a long-lived process, and that changes the trade-offs

The platform is moving to cPanel shared hosting under Passenger, not staying on Vercel's serverless functions. Three design consequences follow, and they cut both ways:

**In favour.** An in-process cache actually persists, so the subdomain→tenant lookup is a one-time cost per process rather than per cold start — which is what makes Decision 7's resolution affordable given the server has no cache layer today. The connection pool is one stable pool rather than one per concurrent function instance, which removes the pool-exhaustion ceiling that would otherwise be the first wall a multi-tenant serverless deployment hits. There are no cold starts.

**Against.** Every tenant shares one CPU-throttled, memory-capped process pool. Noisy-neighbour isolation, which on Vercel is somewhat handled by the platform, becomes entirely this application's problem — one merchant's report query or bot traffic stalls every other merchant. This is listed as a risk rather than solved here, because the correct answer is queueing and query budgets, which is its own change.

**`PrismaPg` is constructed with no pool configuration at all** — `new PrismaPg({ connectionString })`, taking `pg`'s default. That default was survivable for one merchant on serverless. It is not a setting to leave unexamined when one process serves every merchant, so sizing it is a task.

### Decision 8: `StoreSetting` is re-keyed to `tenantId`

The row stays one-per-shop; what changes is what "one" is scoped to. `tenantId` becomes the unique key and the `"singleton"` default id is removed, so there is no caller-supplyable selector at all — the settings endpoints take no id, which is what makes a cross-tenant settings read unexpressible rather than merely blocked.

The model's doc-comment inverts and must be rewritten, not deleted: it currently instructs future readers never to create a second row.

### Decision 9: Cache tags carry the tenant as a suffix

`store-settings` becomes `store-settings:<tenantId>`, and so on for all twelve tags. The server and storefront never import from each other — these tags match only by string — so `scripts/verify-revalidate-tags.ts` is extended to assert the scoped form on both sides. That script already exists for exactly this drift.

*Alternative considered — one tag per tenant covering everything (`tenant:<id>`).* Rejected: it collapses twelve invalidation scopes into one, so editing a blog post would rebuild the whole catalog. The existing per-resource granularity is deliberate and is kept.

### Decision 10: CORS allowlist is DB-driven with an in-process cache

Tenant subdomains are not known at deploy time, so the hardcoded `allowedOrigins` array in `app/app.ts` cannot hold them. The `cors` origin option becomes a function that checks the origin against known tenant subdomains, cached in process with a short TTL so the check is not a database round trip per request. The deployed first-party origins stay hardcoded as they are.

### Decision 11: One migration, backfill inside it, `NOT NULL` at the end

The column is added nullable, backfilled to tenant #1, then altered to `NOT NULL` — in that order, within one migration. `NOT NULL` from the start would fail against existing rows; leaving it nullable permanently would make "unattributed row" a representable state, and the `api/tenancy` spec forbids it.

Unique constraints are dropped and recreated as composites in the same migration. Composite indexes lead with `tenantId`, since every query filters on it.

## Risks / Trade-offs

**Raw SQL bypasses the extension** → `$queryRaw`/`$executeRaw` are invisible to it. Audit every occurrence in `src/` as an explicit task; each either gains a literal tenant predicate or is rewritten through the query builder. A new verify script fails the build on a raw query with no tenant predicate, so this cannot regress silently.

**Nested writes are hard to scope automatically** → a `create` with nested `connect`/`createMany` can reach related models the extension sees only as part of one operation's arguments. Mitigation: the audit task enumerates nested writes, and the cross-tenant verify script exercises the nested paths specifically (order → items → stock movement is the deepest and highest-value).

**`connect` by a formerly-unique field breaks** → `connect: { slug }` no longer identifies a row now that slug is unique per tenant. These are compile-time failures after `prisma generate`, so they surface loudly rather than silently. Listed as a task because the count is large, not because it is dangerous.

**better-auth's own queries never pass through the extension** → accepted, and Decision 4 makes it correct-by-design rather than a hole: those tables are deliberately global. The risk is a future change adding a tenant-owned field to `User`. Mitigation: the doc-comment on `User` states the rule.

**The escape hatch becomes the normal path** → the failure mode is cultural, not technical. Mitigations: it is one named function, so misuse is greppable; every call writes an `AuditLog` row; and no endpoint in this change uses it, so the first use will appear in a diff rather than in a pile of existing ones.

**Backfill runs against the live database** → the migration touches every row of every table. Mitigations: take a backup first (the platform already has a backup/restore change), run the backfill inside the migration's transaction so a failure rolls back whole, and rehearse against a branch of the production database before running it for real.

**Migration tooling against Neon** → `prisma.config.ts` already points migrations at `DIRECT_DATABASE_URL` for the `channel_binding` problem. A migration this size is not the moment to discover that is misconfigured; verifying it is the first task.

**Write amplification and index size** → ~57 tables gain a column and at least one index. Accepted: the column is a short id, and every index that grows is one that a tenant-filtered query needs anyway.

**Cross-tenant `orderBy` on a relation** → `QueryBuilder` supports dotted relation sorts, and a sort through a relation is a join. The extension scopes both sides, but the interaction is the least-covered part of the design. The cross-tenant verify script covers relation-sorted list endpoints explicitly.

**`COUNT` on every list, over tables that are now N× larger** → `QueryBuilder.execute()` runs a count beside every `findMany`. A count filtered by a leading-`tenantId` index stays proportional to that tenant's rows, so the common case is flat. The exposure is counts that also filter or sort through a relation, where the join's other side is a shared table. Mitigation: composite indexes lead with `tenantId` (task 5.5), and the performance budget task measures the worst list endpoints before and after rather than assuming.

**Subdomain-per-tenant needs wildcard DNS and a wildcard certificate, and cPanel AutoSSL generally cannot issue one** → AutoSSL validates over HTTP, and a wildcard certificate requires DNS-01 validation. On a shared account whose DNS is at the registrar, this typically fails. Without a wildcard cert, every new merchant means creating a subdomain and issuing a certificate by hand — which is compatible with manual billing activation but **not with self-serve signup**. This is the single most likely thing to block the business model on this runtime, so it is a preflight task, not a deployment-day discovery. Options are a purchased wildcard certificate, moving DNS to the host so DNS-01 can work, or accepting a manual provisioning step per merchant.

**PostgreSQL may not be available on the target shared plan** → the schema is Postgres-specific throughout (`@db.Decimal`, Json columns, `uuid(7)`), and many cPanel shared plans offer only MySQL. There is no partial answer here: if the plan cannot run Postgres, either the hosting choice or the database changes, and both are far larger than this change. Verify before any other work.

**Next's data cache writes many small files, and shared hosting caps inodes** → the storefront's ISR and fetch caches live on disk under `.next/cache`. Decision 12 multiplies the entry count by the tenant count. cPanel plans commonly cap inodes well below what a large catalog across many tenants would produce, and hitting that cap fails writes in ways that do not look like a cache problem. Monitor inode usage as tenants are added; a shared cache handler backed by the database is the escape route if it becomes real.

**Two Node applications plus Postgres on one shared account** → the server and the storefront are both long-lived processes, and `CPANEL-DEPLOY.md` already records that `next build` is killed by the host's RAM and process limits. Serving many tenants from that same envelope is a capacity question this change does not answer. It does not block the boundary work, but it belongs in the same conversation as pricing.

**Noisy neighbour** → one throttled process pool serves every merchant, so one expensive report or one merchant's bot traffic degrades everyone. Out of scope to solve (it needs queueing and per-tenant query budgets), but recorded because on the previous runtime the platform absorbed some of this and on this one it does not.

## Migration Plan

1. Verify `DIRECT_DATABASE_URL` is configured and `prisma migrate` runs clean against a branch of production data.
2. Back up production.
3. Deploy the schema migration: add `Tenant`/`TenantMembership`, add nullable `tenantId` to tenant-owned models, backfill to tenant #1 (created from the existing `StoreSetting` singleton), convert `User.roleId` into a membership row per existing user, drop `User.roleId`, re-key `StoreSetting`, swap unique constraints, set `NOT NULL`.
4. Deploy the server with resolution middleware, the client extension and the updated `checkAuth`.
5. Run the two new verify scripts plus the existing suite against the live database.
6. Deploy the `admin` and `frontend` companion changes.

**Rollback.** Steps 3 and 4 are one deployable unit — the old server cannot run against the new schema (`User.roleId` is gone) and the new server cannot run against the old one. Rollback is therefore restore-from-backup, not a down-migration, and that is the reason step 2 is not optional. Everything before step 3 is reversible by not proceeding.

**Zero-downtime is explicitly not attempted.** Doing it would mean an expand/contract sequence across several deploys, with the tenant boundary half-enforced in between — which is the exact state this change exists to avoid. A short planned maintenance window on a single-merchant platform is the cheaper and safer trade.

**Sequencing against the hosting move.** The runtime is changing to cPanel shared hosting independently of this change, and the two must not happen together: if the platform moves hosts and becomes multi-tenant in one step, a failure afterwards cannot be attributed to either. The recommended order is to settle the hosting questions in section 1 of the tasks *first* — they are verification, not work — then complete the move with the app still single-tenant, and run this migration on the settled runtime. That way Passenger, Postgres and certificates are debugged against an application that is already known to work.

The order is a recommendation rather than a constraint: none of the code in this change differs between the two runtimes. What differs is how much is unknown at once when something breaks.

## Open Questions

- **Subdomain format and reserved names.** `shop.platform.com` versus `platform.com/shop` is settled (subdomain), but the reserved list (`www`, `api`, `admin`, `app`, …) and the validation rules for a merchant-chosen subdomain can be decided when signup is built. Nothing in this change depends on it: tenant #1 is configured directly.
- **Cookie domain strategy across subdomains.** A cookie on `.platform.com` is visible to every tenant subdomain; a cookie per subdomain is isolated but complicates a future tenant switcher. This affects the `frontend` companion change and not the server's resolution logic. Note that `CPANEL-DEPLOY.md` already records production cookies as `Secure` + `SameSite=None`, so whichever way this lands, it lands on top of that.
- **Where the tenant assertion secret lives and how it rotates.** Decision 7 introduces a second shared secret between storefront and server, alongside `STOREFRONT_REVALIDATE_SECRET`. Whether they are one secret or two, and how either is rotated without a window where requests fail, can be settled when the `frontend` companion change is written — the server's side is the same either way.
- **Retention for a suspended tenant's data.** `Tenant.status` is stored but nothing gates on it here. The answer belongs with the billing change that introduces suspension.
