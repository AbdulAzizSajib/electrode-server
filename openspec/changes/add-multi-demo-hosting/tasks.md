## 1. Measure before building

- [ ] 1.1 Deploy the merchant's own site to cPanel as its own stack, following today's `CPANEL-DEPLOY.md` with no demo map. This is a real deployment, not a rehearsal — it ships the site and exercises the client path.
- [ ] 1.2 Read **Physical Memory Usage** in cPanel with that stack running and record the number in this change folder. If a stack costs far less than the ~230–320 MB estimated, say so — separate stacks for the demos become reasonable and sections 2–6 become optional rather than necessary (design, Migration Plan step 2).

## 2. Server: demo resolution

- [x] 2.1 Add `src/app/lib/tenant.ts`: parse `DEMO_DATABASES` (JSON object, demo key → connection string) once at startup; expose the parsed map and whether it is empty.
- [x] 2.2 In the same module, add the client registry — a `Map<string, PrismaClient>` built lazily per key, plus the default client built eagerly from `DATABASE_URL`. Every client uses `PrismaMariaDb` exactly as `lib/prisma.ts` does today.
- [x] 2.3 Add the `AsyncLocalStorage` store and `currentClient()`, which returns the scoped client or the default when no scope is active. The no-scope path is what seeds, jobs and every `verify-*` script rely on — spec scenario "Background work outside a request is still served".
- [x] 2.4 Rewrite `src/app/lib/prisma.ts` to export a `Proxy` over `currentClient()` per design Decision 3. Keep the export name and shape so all 54 importing files compile untouched — verify that count after the change, it must still be 54 files with zero edits.
- [x] 2.5 Add the Express middleware in `src/app/app.ts` that reads the demo-key header, resolves it against the map, and runs the rest of the request inside the store. An absent header, an empty map, or an unknown key all fall through to the default — never an error (spec: "An unknown key falls back rather than failing").
- [x] 2.6 Register the middleware above every route and above `checkAuth`, so authentication itself resolves against the right demo's database.
- [x] 2.7 Add `DEMO_DATABASES` to `.env.example` as optional, with a one-line note that leaving it unset is the normal case and gives today's behaviour.
- [x] 2.8 Confirm `src/app/config/env.ts` still requires exactly the variables it required before — `DEMO_DATABASES` must not join the required list, or every client installation starts failing to boot (spec: "A client installation is configured exactly as before").

## 3. Server: verification

- [x] 3.1 Add `scripts/verify-demo-isolation.ts`: with two demo databases configured, create a product under key A, then assert it is absent under key B and present under A. Covers "Two demos hold separate catalogues".
- [x] 3.2 Extend it with concurrency: issue interleaved keyed requests for A and B through `Promise.all` and assert neither observes the other's writes. This is the assertion that the `AsyncLocalStorage` scope actually survives `await` — design Decision 3's central claim.
- [x] 3.3 Extend it with a transaction: place an order under key A and assert every row it wrote is in A's database and none in B's. Covers "A transaction stays on one database".
- [x] 3.4 Extend it with the fallback cases: no header, empty map, and an unknown key each resolve to `DATABASE_URL` without error.
- [x] 3.5 Run the full `verify-*` suite with **no** demo map configured and confirm the pass count is unchanged from before this change. This is the regression gate for every client installation; a single new failure here means the default path moved.

## 4. Storefront: demo key and cache scoping

- [x] 4.1 Add a helper that resolves the current request's demo key from the incoming hostname (`next/headers`), returning a constant default when the hostname maps to nothing. One place, so server components and route handlers agree.
- [x] 4.2 Attach the key as a header in `src/lib/api-client.ts` (`apiFetch`, used by server components) and in `src/lib/api-proxy.ts` (`proxyRequest`, used by the cookie-authenticated route handlers).
- [x] 4.3 Add a tag helper that suffixes every cache tag with the demo key, and route **every** `tags:` call site through it. Missing one is the failure a prospect sees — design, Risks.
- [x] 4.4 Make `src/app/api/revalidate/route.ts` build its tag through the same helper, so an invalidation reaches the tag the fetch actually wrote (spec: "Invalidating one demo leaves the others cached").
- [x] 4.5 Confirm theme, fonts, currency and content width — server-rendered from store settings in `src/lib/theme.ts` — follow the demo automatically once the API resolves correctly. No change expected; assert it rather than assume it.
- [x] 4.6 Add a storefront check that fetches the same product list under two demo keys and asserts the results differ, and that invalidating one leaves the other's cache intact.

## 5. Admin: one build, many demos

- [x] 5.1 Change `BASE_URL` in `admin/src/lib/api/client.ts` to `VITE_API_BASE_URL` when set, else the current origin — never the `localhost` fallback, which only ever helped the developer who built it (design Decision 7).
- [x] 5.2 Make the admin attach the demo key derived from `window.location.hostname`, so a keyed API call reaches the right database.
- [x] 5.3 Update the comment block in that file and `admin/src/vite-env.d.ts`, both of which currently state the build-time rule as absolute.
- [x] 5.4 Verify a build **with** `VITE_API_BASE_URL` set still calls exactly that URL and ignores its origin — this is what every client installation does (spec: "An explicitly configured admin base URL still wins").

## 6. Deployment

- [x] 6.1 Add a demo-host section to `CPANEL-DEPLOY.md`: one subdomain and one MySQL database per demo, the `DEMO_DATABASES` JSON shape, and `?connection_limit=2` on each demo URL with the reason.
- [x] 6.2 Document the reset routine in the same section — `mysqldump` per demo after seeding, restore after a prospect has clicked through it. Manual by decision; no code (design, Non-Goals).
- [x] 6.3 State plainly in that section that the demo host holds demonstration data only, and why the demo key is not a security boundary (spec: "The demo key is not a security boundary").
- [x] 6.4 Confirm the client deployment section is **unchanged** — same env list, same steps. If it needed an edit, something in sections 2–5 broke the guarantee this change is built around.
- [x] 6.5 Note in the root `CLAUDE.md` database section that `DEMO_DATABASES` exists, is optional, and is set on exactly one machine.

## 7. Gate

- [x] 7.1 Build and lint across all three apps. Server is clean (build 0, lint 0). Admin `build` exits 2 and `lint` exits 1, and frontend `lint` exits 1 — all three reproduce identically with this change stashed, so they are pre-existing and untouched here: admin has 3 TS errors in `home-slider/` files this change never opened, and the frontend carries 431 lint errors across the tree. My own files lint clean.
- [x] 7.2 `npx tsx scripts/verify-postman-routes.ts` green — no endpoint changed.
- [x] 7.3 Full suite with no demo map: 58 pass / 9 fail, identical to the pre-change baseline. `verify-demo-isolation` skips rather than fails when unconfigured, so the guard for client installations is clean.
- [x] 7.4 Full suite with a two-demo map: 59 pass / 8 fail — the same 8 pre-existing failures plus `verify-demo-isolation` passing all 13 of its checks. Configuring demos changes no other script’s result.
- [ ] 7.5 On the demo host, walk one demo end to end as a prospect would — storefront, admin login, add a product, see it on that storefront and on no other.
