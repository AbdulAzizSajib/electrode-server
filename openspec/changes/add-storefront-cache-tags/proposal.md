## Why

**A merchant saves in the admin, and the storefront keeps showing the old thing for up to five minutes.** There is no way to tell whether the save worked, so the merchant saves again, reloads, clears their browser cache, and eventually concludes the feature is broken. The save *did* work — the storefront is serving a cached response and will not re-fetch until its revalidate window elapses on its own.

This is already solved for five resources. `store-settings`, `blog-posts`, `testimonials`, `landing-pages` and `seo-config` each declare a cache tag, and the backend POSTs `/api/revalidate` on every write so the tag is dropped the moment the data changes. The mechanism exists, works, and is documented in `CLAUDE.md`.

Seven resources were never wired into it: **campaign, banner, brand, category, page, product and review**. Their services pass `revalidate` with no `tags`, so there is no tag to drop; and their backend services never call `revalidateStorefront`, so nothing would be dropped even if there were. Five of them wait a full five minutes.

The trigger was a deleted campaign. A merchant created an EID campaign, checked the storefront, pushed, then deleted the campaign — and the Deal of the Week countdown kept rendering. `DealOfWeek` re-checks its own deadline on the client, so an *expired* campaign hides itself; a *deleted* one has no deadline to pass and stays on screen for the rest of the window. The same gap applies to every one of the seven: an unpublished page, a renamed category, a hidden banner, a corrected price.

## What Changes

### Seven resources gain a cache tag and fire it from the backend

Each of the seven follows the pattern the existing five already use, unchanged:

| Resource | Tag | Window today |
|---|---|---|
| Campaign | `campaigns` | 300s |
| Banner | `banners` | 300s |
| Brand | `brands` | 300s |
| Category | `categories` | 300s |
| Page | `pages` | 300s |
| Product | `products` | 60s |
| Review | `reviews` | 30s |

- The storefront service exports a `*_CACHE_TAG` constant and passes it in `tags: [...]` on every `apiFetch` for that resource.
- The tag is added to `ALLOWED_TAGS` in `nextjs/src/app/api/revalidate/route.ts`.
- A matching constant is added to `server/src/app/utils/revalidateStorefront.ts`.
- The backend service calls `revalidateStorefront(<TAG>)` after **every** create, update and delete.

### Tags are global per resource, not per item

One tag covers a whole resource: editing any product drops `products`, which invalidates the catalog listing and every product detail page at once. There is deliberately **no** `product-<slug>` tag.

Per-item tags would invalidate less, but `ALLOWED_TAGS` is an exact-match `Set` — a `product-<slug>` scheme requires turning that allow-list into prefix matching, which loosens the one security property the endpoint has. At this catalog's size, rebuilding a few listing pages is cheaper than that trade. The door stays open: adding per-item tags later is additive and does not invalidate this design.

### Revalidate windows are unchanged

No window is shortened. The windows stay as they are precisely *because* the tags now exist — the window stops being the expected latency and becomes what `CLAUDE.md` already calls it, "the floor of correctness": the backstop for when a revalidate call is lost, the backend cannot reach the storefront, or the secret is unset.

Shortening windows instead of adding tags was considered and rejected. It would still leave a wait, and it multiplies backend load on every resource for every visitor — which costs money on Vercel and CPU quota on the shared hosting this will be deployed to.

### An unconfigured deployment is diagnosable

`revalidateStorefront` no-ops and warns once when `STOREFRONT_REVALIDATE_SECRET` is unset, and `/api/revalidate` returns 503 when `REVALIDATE_SECRET` is unset. Both behaviours are correct and stay. But an operator currently has no way to confirm the pairing is live short of watching logs — and with seven more callers depending on it, a silently unconfigured deployment now degrades twelve resources instead of five. The change adds an explicit verification path so "is revalidation working?" is answerable.

**Not breaking.** No API shape changes, no schema changes, no migration. Every change is additive: a `tags` array on fetches that already pass `revalidate`, new entries in an allow-list, and new fire-and-forget calls that already cannot fail a mutation.

## Capabilities

### New Capabilities

- `storefront-cache-invalidation`: how a storefront read's cached response is invalidated when its source data changes — which resources are tagged and under what tag name, the granularity of a tag (whole-resource, not per-item), the obligation that every mutating backend service fires its tag on create, update and delete, the allow-list contract that governs which tags `/api/revalidate` will drop, what a deployment does when revalidation is unconfigured, and the role of the revalidate window as a correctness floor rather than the expected refresh latency.

### Modified Capabilities

None. Cache invalidation has never been specified in a root `openspec/specs/` capability — the existing five tags were each added incidentally alongside the feature that needed them, and the mechanism is documented only in `CLAUDE.md` prose and file comments. The capability above carries the whole mechanism going forward, including the five already-working resources, so the rule is stated once rather than re-derived per feature.

## Impact

**nextjs/**
- `src/services/{campaign,banner,brand,category,page,product,review}.ts`: each exports a `*_CACHE_TAG` constant and passes `tags: [...]` alongside its existing `revalidate`. Note `product.ts` has three `apiFetch` call sites and `category.ts` has two — **every** call site for a resource must carry the tag, or the untagged one keeps serving stale data after the tagged ones refresh.
- `src/app/api/revalidate/route.ts`: seven imports and seven entries in `ALLOWED_TAGS`, which grows from 5 to 12.

**server/**
- `src/app/utils/revalidateStorefront.ts`: seven new exported tag constants beside `STORE_SETTINGS_TAG` and `SEO_CONFIG_TAG`, each with the `///`-style comment naming the storefront constant it mirrors.
- `src/app/module/{campaign,banner,brand,category,page,product,review}/*.service.ts`: a `revalidateStorefront(<TAG>)` call after every create, update and delete. `campaign.service.ts` currently imports nothing from `utils/` and has three mutating functions; the others must each be audited for *all* their mutating paths, including bulk operations, status toggles and image replacement — a create-only wiring leaves deletes stale, which is the exact bug that prompted this change.
- New `scripts/verify-revalidate-tags.ts`: asserts every storefront tag constant has a backend counterpart and that the two spellings match. A tag that is fired but not allow-listed fails with a 400 the backend only logs, so the mismatch is otherwise silent.

**Cross-cutting**
- `CLAUDE.md`: the cache-invalidation section currently describes the mechanism as applying to a handful of resources; it should name the full tag set and state the per-resource granularity rule, since "adding a cached resource means adding its tag" is now a twelve-resource convention rather than a five-resource one.

**Deployment**
- Both `STOREFRONT_REVALIDATE_SECRET` (server) and `REVALIDATE_SECRET` (storefront) must be set to the same value for any of this to take effect. This is existing configuration, not new — but it moves from "five resources are slower than intended" to "twelve resources are", so it is worth confirming during apply rather than discovering later.

**Explicitly out of scope**
- Per-item tags (`product-<slug>`) and the prefix-matching allow-list they require.
- Any change to revalidate window durations.
- `auth.ts`, which uses `revalidatePath("/", "layout")` rather than tags. Session changes invalidate a route tree, not a resource, and that is the correct tool there.
