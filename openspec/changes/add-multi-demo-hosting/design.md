## Context

See [proposal.md](proposal.md) — Why. The facts that decide the shape:

- **The cPanel account allows 2 GB of physical memory**, 30 entry processes and 100 processes. Subdomains, databases and inodes are unlimited; disk is 10 GB; addon domains are capped at 5. Memory is the only binding limit, and it binds hard.
- **The admin panel costs no memory.** It is a Vite SPA served as static files, not a Node process. Only the Express API and the Next.js server occupy RAM, so a stack is ~230–320 MB rather than ~400.
- **cPanel binds one Node.js app to one Application URL.** Several subdomains cannot be pointed at one app the way an Apache `ServerAlias` would. This single fact decides how a demo is identified — see Decision 2.
- **54 files import `{ prisma }` from `lib/prisma`.** Any design that changes how a service gets its client touches all of them.
- **The storefront's cache tags are global today.** `revalidateTag("products")` with no scope.
- **Both clients bake their API base URL at build time** — `NEXT_PUBLIC_*` is inlined by Next, `VITE_*` by Vite.
- Selling to a client means cloning the codebase onto their own cPanel. That path must not change.

## Goals / Non-Goals

**Goals:**

- Four demo shops on four subdomains from one Express process and one Next.js process, with a fifth, sixth or tenth costing no additional memory.
- A client installation whose configuration, build and deploy steps are byte-for-byte what they are today.
- No change to any service, controller, validation or schema file.

**Non-Goals:**

- **Multi-tenancy.** This is demo hosting. Paying clients get their own cPanel, their own database and their own deployment, exactly as decided when the SaaS model was dropped. Nothing here is a step toward tenant-per-row, a `tenantId` column, or shared production data.
- **Isolating one demo from another as a security property.** See Decision 6.
- **Self-serve demo creation.** A demo is a subdomain and a database the merchant creates by hand.
- **A demo reset button.** Restoring a demo a prospect has clicked through is a `mysqldump` the merchant keeps and restores; it is documented, not built.
- Retuning anything about how the storefront or API performs.

## Decisions

### 1. Hybrid: the merchant's own site is a separate stack, the four demos share one

Five separate stacks is ~1.5 GB of 2 GB. One shared stack for all five is ~300 MB but puts the merchant's real, revenue-carrying site in the same process as four demos a prospect is clicking through — one crash takes down the real site with them.

**Chosen: the merchant's own site gets its own stack (~300 MB), the four demos share one (~300 MB).** ~600 MB of 2 GB, and demos five through ten cost nothing.

The second reason matters more than the memory: the merchant's own site is then deployed **exactly the way a client's site is** — same tarball, same env list, no demo map. The client deployment path is therefore exercised every day rather than only on the day of a sale.

*Alternative considered:* five separate stacks. Rejected on headroom — 75% of memory consumed leaves nothing for a traffic spike or a Next.js regeneration, and the kernel chooses which process to kill, which could be the real site. It is also five builds and five uploads per change, which is what makes demos go stale.

### 2. The demo key travels as an explicit header, not as the Host

The obvious design is for the API to read its own `Host` and map it to a database. **It cannot**: cPanel binds one Node app to one Application URL, so the API lives at one hostname — `api.<merchant>.com` — and every request arrives with that same Host whichever demo it came from.

So the caller names the demo:

- The **storefront** runs server-side for every API call it makes (`apiFetch` from server components, `proxyRequest` in route handlers), so it can read the incoming request's hostname with `next/headers` and attach the key.
- The **admin panel** runs in the browser, and its own `window.location.hostname` is the demo's, so it attaches the key the same way.

The API reads the header, looks it up in the map, and falls back to `DATABASE_URL` when the header is absent, the map is empty, or the key is unknown. Falling back rather than erroring is what keeps a client installation from having to know the header exists.

*Alternative considered:* a separate Node app per demo, each with its own Application URL and its own `DATABASE_URL`, no code change at all. This is Decision 1's rejected option — it is the memory cost that rules it out, not the elegance.

### 3. `AsyncLocalStorage` behind a `Proxy`, so the 54 importing files are untouched

The straightforward implementation — pass a client into every service, or have each service resolve its own — edits 54 files and every function signature in them. It would also be a permanent tax: every new service would have to remember.

**Chosen:** `lib/prisma.ts` stops exporting a client and starts exporting a `Proxy`. Every property access on it resolves, at that moment, to the client for the request in scope:

```ts
export const prisma = new Proxy({} as PrismaClient, {
    get: (_t, prop) => Reflect.get(currentClient(), prop),
});
```

`currentClient()` reads an `AsyncLocalStorage` store that one Express middleware entered at the top of the request, and returns the default client when there is none. `import { prisma } from "../../lib/prisma"` keeps working in all 54 files, unchanged, and a service written tomorrow gets the right database without knowing any of this exists.

**Why `AsyncLocalStorage` and not a request-scoped argument:** the store follows `await` boundaries, so a service that fans out with `Promise.all` and a transaction that resumes after a slow query both stay on their own demo's client. Two concurrent requests for different demos never see each other's store — that is the guarantee the spec's "concurrent requests do not bleed" scenario is asserting.

**What this costs:** a `Proxy` indirection on every property access, and stack traces that pass through the trap. Both are negligible next to a database round trip. The real cost is that `prisma` is no longer a value you can hold across requests — any code that captured it at module scope and used it later would resolve against whatever scope it later ran in. Nothing does this today; `verify-*` scripts and jobs run with no scope at all and get the default client, which is correct for them.

### 4. One `PrismaClient` per database, built lazily and cached

Each demo needs its own client because each has its own connection string. Building one per request would exhaust connections immediately; building all at boot would open pools for demos nobody visits.

**Chosen:** a `Map<string, PrismaClient>`, populated on first use of each key. The default client (from `DATABASE_URL`) is built eagerly, because every installation needs it.

**Connection budget is the thing to watch.** Five clients — four demos plus the default — each hold a pool. Shared MySQL accounts cap concurrent connections, so every URL in `DEMO_DATABASES` carries `?connection_limit=2`, and the merchant raises it only if the host's actual cap turns out to be generous. This is a deployment note, not code.

### 5. Cache tags are always scoped; a single shop's scope is a constant

`revalidateTag("products")` in one process serving four demos discards all four, and — worse — a cached `products` list fetched for `fashion` is served on `grocery`'s subdomain. This is the failure most likely to be seen by a prospect, because it looks like the demo is broken rather than like a caching subtlety.

**Chosen:** every tag is built through one helper that suffixes the demo key, and the revalidate route builds its tags the same way. On a single-shop installation the key is a constant — `products:default` rather than `products` — which is a different string but identical behaviour.

**The rule that makes this safe: always scope, never branch.** There is no `if (isDemo)` anywhere. A single shop is the N=1 case of the same code, which is why the spec asserts single-shop invalidation still works: it is the path every client runs and therefore the one that must not be allowed to rot.

### 6. The demo key is routing, not authorisation — stated, not mitigated

Anyone who knows a demo key can send it and read that demo's data. This is not fixed, and the spec says so out loud.

Fixing it would mean a signed key, or resolving the demo from something the caller cannot choose. Both are real work in service of separating four sets of fictional products from one another.

**What makes it acceptable is the blast radius, which is bounded by Decision 1:** the demo host carries demonstration data only. The merchant's own site and every client site run with no demo map, where the header is ignored entirely — so the mechanism is not merely unused there, it is inert.

**If this ever needs to be a real boundary, this design is the wrong one** and should be replaced rather than hardened. That is the sentence this decision exists to record.

### 7. The admin falls back to its own origin; an explicit setting still wins

`BASE_URL` is `import.meta.env.VITE_API_BASE_URL`, inlined at build. One build cannot serve four demos with four API hostnames baked in.

**Chosen:** `VITE_API_BASE_URL` when set, otherwise the current origin. A client installation sets it — the deploy guide already instructs that, and `CPANEL-DEPLOY.md` warns that omitting it ships a panel calling localhost — so client behaviour is untouched. The demo host leaves it unset and every demo subdomain's admin talks to that demo.

This also removes a foot-gun: an admin built without the variable currently falls back to `http://localhost:5000/api/v1`, which fails for everyone but the developer. Falling back to the origin fails visibly and locally instead.

## Risks / Trade-offs

**A tag is missed and one demo shows another's content** → the failure a prospect sees, and it looks like a broken product rather than a caching bug. Mitigated by routing every tag through one helper so a missed one is a missing call rather than a wrong string, and by a verification script that fetches the same list on two demo keys and asserts the results differ.

**The `Proxy` resolves against the wrong scope** → a service reads or writes the wrong demo's data. Mitigated by the default-client fallback being the only behaviour outside a request, and by a verification script that runs concurrent keyed requests and asserts each sees only its own data. The scenario worth being alert to is code that captures `prisma` at module scope; nothing does today.

**Connection exhaustion on the demo host** → five pools against a shared MySQL account. Mitigated by `connection_limit=2` per demo URL, and visible early because it fails loudly with `Too many connections` rather than silently.

**The demo path rots** → it runs on one machine, so a change that breaks it may not be noticed for weeks. Partly mitigated by the N=1-is-the-default rule, which puts most of the code on the path every installation runs; the genuinely demo-only part is small.

**Two prospects are shown demos at once and one is slow** → four demos in one Next.js process share it. Accepted; demo traffic is one or two people at a time by definition.

**The merchant's own site is the fifth thing on a 2 GB account** → ~600 MB leaves ample headroom, but that headroom is the reason the hybrid was chosen rather than a bonus. Adding a sixth *separate* stack would spend it.

## Migration Plan

1. Deploy the merchant's own site first, as a separate stack, following today's `CPANEL-DEPLOY.md` with no demo map. This both ships the real site and measures what a stack actually costs.
2. **Read Physical Memory Usage in cPanel after step 1.** The ~230–320 MB above is an estimate. If a stack turns out to cost far less, the argument for sharing weakens and the merchant may reasonably choose separate stacks for the demos too — the code from this change stays inert in that case, which is the point of Decision 5's no-branch rule.
3. Build the server side, verify it locally with two databases, then the storefront, then the admin.
4. On the demo host: one subdomain and one database per demo, `DEMO_DATABASES` set, `connection_limit=2` per URL.
5. Seed each demo separately, then take the `mysqldump` that is its reset point.

**Rollback:** unset `DEMO_DATABASES`. Every request then resolves to `DATABASE_URL` and the deployment is a single shop again. Nothing to undo in the database, because nothing about the schema changed.

## Open Questions

- The host's actual concurrent-connection cap, which sets `connection_limit`. Answerable only against the host, and it changes a URL parameter rather than anything in this design.
- Whether four demos in one Next.js process stay comfortable in memory. Measurable after step 2 and does not change the approach — if it is tight, the answer is fewer demos, not a different architecture.
