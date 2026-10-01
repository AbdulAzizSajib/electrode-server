## Why

Selling this platform needs something to show a prospect: a working shop in *their* vertical, on its own subdomain, with its own catalogue — four of them (electronics, fashion, grocery, and so on), alongside the merchant's own real site.

Deploying five independent stacks does not fit the hosting. The cPanel account allows **2 GB of physical memory**, and a stack is one Express process (~80–150 MB) plus one Next.js server (~150–200 MB). Five of those is roughly 1.5 GB — 75% consumed with no headroom, and a sixth demo impossible. It is also five builds and five uploads for every change, which is the recurring cost that actually decides whether the demos stay current or rot.

What the account gives away freely is exactly what a shared stack needs: **unlimited subdomains, unlimited databases, unlimited inodes**, and 10 GB of disk.

The constraint that shapes everything below: **a client's installation must not get more complicated because the demo server exists.** Selling to a client means cloning this codebase onto their own cPanel with their own database — that path stays exactly as it is today.

## What Changes

- **A demo key can be carried on a request, and it selects which database serves that request.** One backend process serves all four demos. Absent the key — or absent any configured demo map — the request is served by the single `DATABASE_URL`, which is what every client installation and the merchant's own site will do.
- **`DEMO_DATABASES` is a new, optional env var** mapping demo keys to connection strings. It is set on one machine: the merchant's demo host. Unset, the whole mechanism is inert.
- **The storefront forwards its own hostname's demo key to the API**, so one Next.js process can serve `electronics.`, `fashion.`, `grocery.` and `pharmacy.` subdomains from one deployment.
- **BREAKING for the storefront's cache, invisibly so if done wrong**: Next.js cache tags become demo-scoped. Today `revalidateTag("products")` is global; with four demos in one process an unscoped tag serves one demo's catalogue on another's subdomain. Single-installation behaviour is unchanged because the scope is a constant there.
- **The admin panel derives its API base from its own origin** when `VITE_API_BASE_URL` is not set, so one build serves every demo subdomain. Installations that set the variable — which is what the deploy guide tells a client to do — behave exactly as before.
- **The merchant's own site is deployed as its own separate stack**, not as a fifth demo. It gets the same treatment a client gets, which keeps the client deployment path exercised daily rather than only at sale time.
- `CPANEL-DEPLOY.md` gains a demo-host section: subdomain and database per demo, the `DEMO_DATABASES` shape, and the manual `mysqldump`/restore routine for putting a demo back after a prospect has clicked through it.

## Capabilities

### New Capabilities

- `api/demo-hosting`: which database serves a request, how a demo is identified, and the guarantee that an installation with no demo map behaves exactly as a single-shop installation always has.

### Modified Capabilities

None. No existing endpoint changes its request or response shape, and no existing requirement changes for a single-shop installation. That is the point of the change rather than an accident of it, and `api/demo-hosting` states it as a requirement so a later edit cannot quietly make the demo path mandatory.

## Impact

**server** — `src/app/lib/prisma.ts` becomes a resolver rather than a singleton; a new `src/app/lib/tenant.ts` owns the demo map, the per-database client cache and the request scope; `src/app/app.ts` gains one middleware. **The 54 files that `import { prisma }` are untouched** — see design.md, Decision 3.

**frontend** — `src/lib/api-client.ts` and `src/lib/api-proxy.ts` attach the demo key; every `tags:` call site and `src/app/api/revalidate/route.ts` scope their tags.

**admin** — `src/lib/api/client.ts` falls back to the current origin.

**Deployment** — `CPANEL-DEPLOY.md`, plus `.env.example` for the new optional variable.

**Not affected** — no schema change, no migration, no Postman change, no change to any service, controller or validation file. A client installation's environment variables are the same list as today.

**Accepted risk, stated rather than mitigated**: the demo key is supplied by the caller, so on the demo host one demo's data is reachable by asking for it. That is acceptable because the demo host holds only demonstration data, and it is inert everywhere else — with no `DEMO_DATABASES` configured the key is ignored entirely. Design.md records why this is not treated as a security boundary and what would have to change if it ever needed to be one.
