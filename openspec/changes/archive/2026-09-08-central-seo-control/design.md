## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **`StoreSetting` is a singleton row** (`id = "singleton"`, upserted) whose `PATCH /settings` is a *partial* upsert. Six separate admin editors already write to that one endpoint without clobbering each other because omitted keys are left untouched, and because the backend treats fields as `.optional()` rather than `.nullable()` — "clear a value" means omitting the key, never sending `null`. Any new SEO screen must obey that same contract.
- **Two read shapes already exist and must stay separate**: `GET /settings/public` merges defaults for the storefront, while `GET /settings` returns the stored row as-is so the admin can distinguish "never set" from "set to the default value".
- **The storefront caches settings by tag** (`store-settings`, 30s revalidate) and the backend already fire-and-forgets a revalidation ping (`revalidateStorefront.ts` → `POST /api/revalidate` with `x-revalidate-secret`, against an allow-list of four tags).
- **SEO columns already exist** but under two different naming conventions: `Product`/`Category` use `seoTitle`/`seoDescription`; `Page`/`BlogPost`/`LandingPage` use `metaTitle`/`metaDescription`. Product and Category validation already accepts them — only the admin UI never rendered them.
- **Admin is a Vite SPA** where a page is only reachable once registered in *both* `nav-config.ts` and `app-router.tsx`; settings-shaped screens use the `useSettingsDraft` + `useUnsavedChangesGuard` draft pattern, list screens use `ResourceListPage`.
- The user asked for maximum speed and minimal testing overhead: happy-path first, 1–2 tests per endpoint, no exhaustive negative coverage.

## Goals / Non-Goals

**Goals:**

- One storage location for global SEO config, reachable from one admin menu, with zero new tables.
- A single metadata resolution function shared by every storefront route, so precedence (record → display → global default) is defined once rather than re-implemented per page.
- Per-record SEO editable from both the record's own form and the central overview, writing the *same* columns — no shadow copy, no sync step.
- Additive, reversible schema change.

**Non-Goals:**

- Renaming `metaTitle`/`metaDescription` → `seoTitle`/`seoDescription` (or vice versa) to unify the two conventions. It is a wide, breaking rename across five models, five validators and five admin forms, for zero user-visible gain. The overview normalizes the difference at read time instead.
- Keyword/rank tracking, redirect management, sitemap index sharding, i18n `hreflang`, or per-record `canonicalUrl` overrides. All are plausible follow-ups; none are needed to put SEO under one menu.
- Backfilling or migrating existing per-record SEO values — they stay exactly where they are.
- A generic "settings blob" abstraction. `seoConfig` is one more Json column following the established pattern, not a new framework.

## Decisions

### 1. Store global SEO as a `seoConfig Json?` column on `StoreSetting`, not a new table

`StoreSetting` already carries eight Zod-gated Json blobs (`mainNav`, `footerColumns`, `checkoutConfig`, `theme`, `catalogConfig`, …). A ninth is the boring, consistent choice: it inherits the singleton upsert, the partial-PATCH semantics, the existing `checkAuth(OWNER, ADMIN)` guard, the public projection, and the storefront's existing cache tag — roughly four files instead of a new module with its own migration, service, routes, and cache lifecycle.

*Alternatives considered.* A dedicated `SeoSetting` table: cleaner typing, but buys a second singleton with its own upsert and revalidation path for no behavioral gain. Flat columns on `StoreSetting`: ~20 new columns, and every subsequent SEO field becomes a migration — the blob keeps iteration cheap, which is what "maximum speed" asks for.

*Trade-off accepted.* Json means no DB-level typing; correctness rests entirely on `seoConfigZodSchema` at the write boundary and on the `DEFAULT_SEO_CONFIG` merge at the read boundary. That is exactly how the other eight blobs already work.

### 2. `PATCH /settings` stays the only write path for global SEO

No `PATCH /seo`. The SEO screens send `{ seoConfig: { ... } }` to the existing endpoint. Because the top-level merge is per-key, the SEO screens and the Site Setting screen cannot clobber each other.

**One wrinkle worth being explicit about:** the top-level partial merge does *not* recurse. `{ seoConfig: {...} }` replaces the whole blob. So the four SEO sub-screens (General, Indexing, Structured Data, Verification) all edit facets of one object and must each send the **full merged `seoConfig`**, not their own slice. The admin fetches current config into a draft, applies its section's edits, and PATCHes the whole object — which is precisely what `useSettingsDraft` already does for `checkoutConfig` and `theme`.

*Alternative considered.* Deep-merging `seoConfig` server-side. Rejected: it makes "delete a custom robots rule" unexpressible (arrays cannot be deep-merged unambiguously), and it would make `seoConfig` behave differently from every other blob on the model.

### 3. `GET /seo/overview` is a read-only aggregator; writes go to each resource's existing endpoint

The overview queries five models, normalizes the two naming conventions into one `{ id, contentType, title, path, metaTitle, metaDescription, updatedAt }` row shape, and returns it paginated. It never writes. Inline edits from the overview call the resource's own existing `PATCH /products/:id`, `PATCH /categories/:id`, etc.

This is what makes the spec's "both entry points agree" requirement true by construction rather than by discipline: there is exactly one writer per field, already built and already validated. A unified write endpoint would need to re-derive per-model authorization and validation, and would let the two paths drift.

*Trade-off.* Five queries per overview page load, and cross-model sorting/pagination must be done in application code after fetching. Acceptable at the catalog sizes this admin targets; if it becomes slow the fix is a materialized view, not a schema change.

### 4. Route-group robots policy is keyed by a fixed enum, not by free-form path patterns

`seoConfig.robots.groups` is a map over a closed set of keys — `home`, `product`, `category`, `blog`, `page`, `landingPage`, `account`, `cart`, `checkout`, `wishlist`, `compare`, `search` — each holding `{ index: boolean, follow: boolean }`. Each storefront route declares which group it belongs to.

A closed enum can be rendered as a checklist the merchant understands, validated exhaustively, and defaulted sensibly (private groups ship `noindex, nofollow`). Free-form path-pattern rules would be more flexible and considerably easier to misconfigure into deindexing the catalog. Custom `robots.txt` lines remain available as an escape hatch for the rare case.

### 5. One shared `resolveMetadata()` on the storefront, called by every route's `generateMetadata`

A single function takes `(seoConfig, storeSettings, routeGroup, record?)` and returns a complete Next.js `Metadata` object — title through the template, description, canonical, Open Graph, Twitter, robots, and verification. Every page's `generateMetadata` becomes a two-line call.

The precedence chain in the spec (record SEO → record display title → global default) has to hold on ~18 routes. Written once it is one thing to get right and one place to test; written per page it is 18 chances to drift, which is how the current `– Electrode` hardcoding happened in the first place.

Title templating uses Next.js's native `title.template` at the root layout where possible, with the shared resolver handling the cases the native template cannot express.

### 6. JSON-LD is emitted by a small server component, gated per type

`<JsonLd data={...} />` renders a `<script type="application/ld+json">`. Builders (`buildOrganizationSchema`, `buildProductSchema`, `buildArticleSchema`, `buildBreadcrumbSchema`) each return `null` when their toggle is off, and the component renders nothing for `null` — so the "disabled type emits nothing" scenario is a single early return rather than conditional JSX at four call sites.

*Note.* Serialized JSON is escaped for `<` and `&` before injection, since product names and descriptions are merchant-controlled free text.

### 7. Sitemap data comes from a purpose-built endpoint, not from the list APIs

`GET /seo/sitemap-entries` returns only `{ contentType, slug, updatedAt }` for published records, honoring the per-type include toggles and the global `noindex` switch server-side. Reusing the paginated storefront list endpoints would mean N round trips and shipping full product payloads to build a URL list.

The sitemap route caches on a `seo-config` tag with a longer revalidate window than the settings tag; a settings save invalidates both.

### 8. New `seo-config` cache tag, added to the existing allow-list

Rather than overloading `store-settings`, SEO gets its own tag so a sitemap rebuild is not triggered by an unrelated theme edit. `revalidateStorefront.ts` fires both tags on a settings save; the storefront's `ALLOWED_TAGS` set gains `seo-config`. Per-record SEO edits fire the tag for their own content type where one exists.

### 9. Moving the SEO card off the Site Setting page is a UI move only

The three existing fields keep their columns (`siteUrl`, `metaTitle`, `metaDescription`) and their meaning. `SEO → General` reads and writes the same top-level keys; only the card at `site-settings-page.tsx:294-330` is deleted. No migration, no data touched, and a merchant who bookmarked the old page loses a card but no data.

*Considered and rejected:* folding these three into `seoConfig` for tidiness. It would require a data migration and break the storefront's current `metadataBase` resolution for zero user-visible benefit.

### 10. Testing: happy path only, 1–2 tests per endpoint

Per the request. Concretely: one test that `PATCH /settings` round-trips a `seoConfig` and leaves a sibling blob untouched; one that `GET /settings/public` merges defaults when `seoConfig` is null; one that `GET /seo/overview` returns rows from all five content types; one that `GET /seo/sitemap-entries` omits unpublished records. Plus one unit test for `resolveMetadata()` precedence — the highest-value test in the change, since it is the one piece of shared logic every page depends on. No negative-path, permission, or edge-case suites in this pass.

## Risks / Trade-offs

- **A merchant enables global `noindex` and forgets** → the switch is destructive to traffic and silent. Mitigation: the Indexing screen renders a persistent warning banner while it is on, and the SEO section header shows an indicator. Not gated behind a confirmation dialog in this pass.
- **`seoConfig` is untyped at the DB level; a malformed blob written out-of-band breaks metadata on every page** → the storefront read path merges over `DEFAULT_SEO_CONFIG` and never throws; a page with unreadable config renders fallback metadata rather than a 500 (spec: "Configuration source is unavailable").
- **A sub-screen sends a stale full `seoConfig` and reverts another screen's concurrent edit** (last-write-wins across the four SEO screens) → mitigated by each screen fetching fresh config into its draft on mount, and by the existing unsaved-changes guard. Genuine concurrent multi-admin editing is not solved here; it is not solved for the existing six settings editors either.
- **Overview does five queries and paginates in application code** → acceptable now, will degrade with very large catalogs. Bounded by search + content-type filter, which is how the screen is actually used.
- **Sitemap grows past the 50k-URL limit** → out of scope; sharding is a follow-up. Worth logging when the entry count crosses a threshold.
- **Adding canonical tags where none existed can consolidate or shift ranking signals** → real but intended; canonical absence is the bug being fixed. `siteUrl` unset means no canonical is emitted, so a misconfigured store is no worse off than today.
- **Product/Category SEO fields become visible for the first time** → they were accepted by validation but never populated, so nearly all are empty. Empty fields fall through to display titles, so surfacing them changes nothing until a merchant fills them in.

## Migration Plan

1. **Schema** — add `seoConfig Json?` to `StoreSetting`; generate and apply the Prisma migration. Purely additive: existing rows get `NULL`, and `NULL` resolves to `DEFAULT_SEO_CONFIG` on read, so the storefront's behavior is unchanged until an administrator saves.
2. **Backend before frontend** — ship `seoConfigZodSchema`, the public projection, and the `/seo` module first. Both clients tolerate the new fields being absent, and the new endpoints are unreferenced until the UI lands.
3. **Storefront** — land `resolveMetadata()`, `sitemap.ts`, `robots.ts`, and JSON-LD. With `seoConfig` still `NULL` everywhere these render current-equivalent metadata plus a sitemap and robots.txt, which the site does not have today and which are safe additions.
4. **Admin** — add the `SEO` nav section and routes, then remove the SEO card from Site Setting *last*, so the fields are never unreachable between deploys.
5. **Rollback** — revert the admin and storefront deploys; the `seoConfig` column can be left in place (unread columns are inert). A DB rollback is only needed if the column itself must go, and it drops merchant-entered SEO config, so prefer reverting the app.
