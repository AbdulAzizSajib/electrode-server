## Context

See proposal.md — Why. The mechanism this change extends already exists and works; five resources use it.

The three moving parts, as they stand today:

- **`nextjs/src/lib/api-client.ts`** — `apiFetch` accepts `revalidate` and `tags`. **`tags` do nothing without `revalidate`**, and `cache` and `revalidate` are mutually exclusive. Seven services pass `revalidate` and omit `tags`.
- **`nextjs/src/app/api/revalidate/route.ts`** — POST, authenticated by `x-revalidate-secret`, validates the tag against an exact-match `Set` of five, then `revalidateTag(tag, { expire: 0 })`. 503 when unconfigured, 401 on a bad secret, 400 on an unknown tag.
- **`server/src/app/utils/revalidateStorefront.ts`** — fire-and-forget POST with a 3s timeout, never awaited, never throws, warns once when `STOREFRONT_REVALIDATE_SECRET` or the storefront URL is absent.

Two constraints shape everything below.

**The tag name is a string duplicated across two packages that never import each other.** `server/` and `nextjs/` are separate workspaces; the backend fires `"campaigns"` and the storefront allow-lists `"campaigns"`, and nothing checks they match. A typo produces a 400 the backend only `console.warn`s — the merchant sees the pre-change behaviour, with no error anywhere they look.

**Deployment target is shifting.** This currently runs on Vercel and is intended for cPanel shared hosting. That rules out anything depending on Vercel-specific cache behaviour, and raises the value of the tags: on shared hosting the binding constraint is CPU and entry processes rather than invocation billing, and the backend→storefront hop becomes localhost rather than a cross-origin request.

## Goals / Non-Goals

**Goals:**

- Every merchant-editable storefront resource invalidates on write, by the same mechanism the existing five use — no second pattern.
- The tag-name duplication across packages becomes mechanically checkable rather than a thing to be careful about.
- Every mutating path is covered, not just the obvious `create`/`update`/`delete` trio.
- An operator can answer "is revalidation configured?" without reading logs.

**Non-Goals:**

- Sharing code between `server/` and `nextjs/`. A shared package for seven string constants is a build-graph change out of proportion to the problem; the verify script covers the same failure for far less.
- Making invalidation reliable. It stays best-effort by design — the revalidate window is the backstop, and that division of labour is already correct.
- Changing `apiFetch`, the revalidate route's auth model, or any revalidate window.
- Touching `admin/`. The admin triggers writes but never invalidates — it is a browser bundle and cannot hold the secret.

## Decisions

### Decision 1: Whole-resource tags, not per-item

One tag per resource (`products`, not `product-<slug>`).

`ALLOWED_TAGS` is an exact-match `Set` — the endpoint's entire security surface is "the tag is one of these literal strings". Per-item tags mean unbounded tag names, so the `Set` becomes prefix matching, and the check weakens from membership to "starts with `product-`".

**Alternative — per-item plus global:** invalidates less (editing one product spares the other 400 detail pages). Rejected for now: this catalog is small, listing rebuilds are cheap, and the allow-list is not worth loosening for it. Additive later — per-item tags can be introduced alongside the resource tag without revisiting this.

### Decision 2: Windows unchanged

No revalidate window is shortened. With tags firing, the window stops being the expected latency and becomes what it should be: the bound on staleness when invalidation is lost.

**Alternative — shorten every window to 30s instead of adding tags:** considered and rejected. It does not remove the wait, only shrinks it, and multiplies read load by up to 10× for every visitor. On Vercel that is invocation billing; on shared hosting it is CPU quota, which is enforced by suspension rather than by an invoice.

### Decision 3: A verify script is what keeps the two tag lists in sync

`server/scripts/verify-revalidate-tags.ts` reads the exported tag constants from `revalidateStorefront.ts` and the `ALLOWED_TAGS` entries from the storefront route, and asserts the two sets are equal — failing on a tag fired but not allowed, and on one allowed but never fired.

It reads the storefront file as **text**, not by importing it: `route.ts` imports `next/cache` and the service modules, so importing it from a `tsx` script under `server/` would pull Next's runtime into a plain Node process. Parsing for the literal strings is the cheaper, more robust boundary.

**Alternative — a shared `packages/cache-tags`:** genuinely correct, and the right answer at a larger scale. Rejected here: it adds a workspace package, a build step, and a dependency edge in both directions for seven strings.

**Alternative — trust review:** this is the current approach, and it is what let seven resources ship untagged.

### Decision 4: Every mutating path fires, and "mutating" is wider than CRUD

The rule is per **write**, not per exported function named `create`/`update`/`delete`. Each of the seven services must be read for all paths that change what the storefront renders: bulk operations, status and visibility toggles, sort-order changes, image replacement, and any write that reaches the resource from a *different* module.

That last case is the one most likely to be missed. A review is created by the review module, but its approval may be a moderation action elsewhere; a product's stock changes on every order. During apply, each service is audited by searching for writes to its Prisma model across the whole `src/`, not by reading the one service file.

Where a single logical operation performs several writes, the tag fires **once after the operation**, not per write — the tag is idempotent, and firing inside a loop sends N requests for one merchant action.

### Decision 5: Firing follows the existing call-site convention

`revalidateStorefront(TAG)` is called after the write commits, not awaited, and not wrapped in try/catch — the function already swallows everything. Where a write happens inside `prisma.$transaction`, the call goes **after** the transaction resolves, never inside it: firing inside means a rollback still invalidates, and worse, the storefront can re-fetch and re-cache the pre-transaction state before the commit lands.

### Decision 6: Cross-resource invalidation is not inferred

A tag fires for the resource that was written. It does not fire for resources that *embed* it.

This is a real limitation, and deliberate. A campaign write changes `campaignPrice` on the products it discounts, so products cached under `products` keep the old price until their own window elapses. Inferring the dependency (campaign write → also drop `products`) is possible but starts a graph — brands appear on product cards, categories appear in menus, reviews carry ratings shown in listings — and a wrong edge either over-invalidates everything or silently misses.

Where a cross-resource drop is genuinely needed, it is stated explicitly at the call site with a comment naming why, exactly as `landing-page.service.ts` already fires both `LANDING_PAGES_TAG` and `STORE_SETTINGS_TAG`. Two such cases are expected and are listed in tasks.md; both are opt-in, not derived.

### Decision 7: Configuration is verifiable without live traffic

`revalidateStorefront` gets an exported predicate reporting whether both a secret and a base URL are present, and the existing boot sequence logs the storefront-revalidation state once at startup alongside the other config warnings.

This is why "unconfigured" needs to be loud: with 12 resources depending on it, a missing env var presents as "the whole admin panel is slow to take effect" — a symptom that looks like a performance problem and is a one-line configuration gap.

## Risks / Trade-offs

**A mutating path is missed during the audit** → The bug survives for that path only, and presents exactly as the reported one. Mitigated by auditing per Prisma model across `src/` rather than per service file (Decision 4), and by tasks.md listing the paths found per resource so the audit is reviewable rather than implicit.

**Tag names drift between the two packages** → Silent: a 400 the backend only logs. This is the single most likely defect in the change, and Decision 3 exists for it. The verify script must be written and run *before* the wiring is reviewed, not after.

**Products invalidate on every order** → Stock is a product field, so order placement is a product write. On a busy store that could drop the `products` tag continuously, making the cache worthless. **Decided: order-placement stock decrements do not fire the tag.** Stock is already the least cacheable field on the page and is re-read at checkout; paying for a full catalog invalidation per order to make a stock number a minute fresher is the wrong trade. Merchant-initiated inventory edits do fire it. This is called out in tasks.md as an explicit exclusion so it is not "fixed" later by someone who reads the omission as an oversight.

**Over-invalidation from whole-resource tags** → A single edit rebuilds more than it needed to. Accepted per Decision 1, bounded by catalog size, reversible by adding per-item tags later.

**cPanel may not sustain a persistent Node process** → `revalidateTag` needs one; if the host kills idle processes, the cache is cold anyway and tags become moot while DB load rises. Out of scope here — it is a deployment question, not a design one — but it is the reason nothing in this change depends on cache state surviving between requests.

## Migration Plan

No schema change, no migration, no API shape change. Every edit is additive and independently deployable.

Deploy order matters in one direction only: **the storefront's `ALLOWED_TAGS` must ship before or with the backend's firing.** Backend-first means every fired tag 400s until the storefront catches up — harmless (it logs and the window still works) but it makes the interval untestable. Storefront-first is inert: allow-listed tags nobody fires yet.

Rollback is per-resource. Removing a `revalidateStorefront` call or a `tags` array restores exactly the current behaviour for that resource, with no residue.

Both `STOREFRONT_REVALIDATE_SECRET` (server) and `REVALIDATE_SECRET` (storefront) must hold the same value. Existing configuration, but confirm it during apply — this change is what makes its absence expensive.

## Open Questions

- **Where the boot-time configuration log belongs** — `server.ts` runs it on listen, but `api.ts` has no listen, so on a serverless deploy it would never run (the same reason `seedSuperAdmin()` never runs on Vercel). Whether to accept that, or log on first invalidation attempt instead, can be settled while writing Decision 7's code; it changes no requirement and no other task.
