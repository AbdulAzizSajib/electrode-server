## Why

SEO in Electrode is scattered across three apps with no single owner. `StoreSetting` holds three lonely fields (`siteUrl`, `metaTitle`, `metaDescription`) buried inside the Site Setting page; `Product` and `Category` carry `seoTitle`/`seoDescription` columns that no admin form ever renders; `Page`, `BlogPost` and `LandingPage` each use a differently-named `metaTitle`/`metaDescription` pair on their own edit screens. Meanwhile the storefront has no sitemap, no robots.txt, no canonical URLs, no Twitter cards, no JSON-LD, and hardcodes the literal string `– Electrode` into a dozen page titles instead of reading store settings.

The result: an admin cannot answer "what is my site's SEO?" from any one screen, and several fields they *can* fill in have no effect on the rendered HTML. This change gives the admin panel one **SEO** menu that owns global SEO configuration and surfaces every per-record override in one place, and makes the storefront actually consume it.

## What Changes

**Admin panel — new top-level `SEO` menu**

- New sidebar section `SEO` (roles `OWNER`, `ADMIN`) with child pages:
  - **General** — canonical `siteUrl`, title template (e.g. `%s | Electrode`), default meta title/description, default OG image, default Twitter card type + handle.
  - **Indexing** — global `noindex` kill-switch, per-route-group robots directives (account, cart, checkout, wishlist, compare, search default to `noindex, nofollow`), extra `robots.txt` rules, sitemap toggles per content type.
  - **Structured Data** — organization/store JSON-LD fields (legal name, logo, contact, social profiles) and toggles for Product / Article / Breadcrumb schema emission.
  - **Verification** — Google Search Console, Bing, and generic `<meta>` verification tokens.
  - **Page SEO** — one table listing every SEO-bearing record across Products, Categories, Pages, Blog Posts and Landing Pages, showing resolved title/description, a length/health indicator, and an inline editor that writes back to the record's own SEO fields.
- The SEO card currently inside `/ui/site-settings` is removed; those three fields move to **SEO → General** (values preserved, same `StoreSetting` columns).

**Backend**

- Extend the `StoreSetting` singleton with a Zod-gated `seoConfig` JSON blob (title template, defaults, OG/Twitter defaults, robots policy, structured-data toggles, verification tokens) — no new table, reusing the existing partial-upsert `PATCH /settings` contract.
- Add `seoTitle`/`seoDescription` to the Category and Product admin write paths that already have the columns (currently accepted by validation but not exposed in the UI).
- New `GET /seo/overview` — a paginated, cross-model list feeding the **Page SEO** table.
- New `GET /seo/sitemap-entries` — slugs + `updatedAt` for published Products, Categories, Pages, Blog Posts and Landing Pages, for the storefront sitemap to consume.
- Extend `GET /settings/public` to include the resolved `seoConfig` so the storefront can render metadata without an extra round trip.

**Storefront (`nextjs`)**

- Root `layout.tsx` metadata gains `title.template`, `openGraph`, `twitter`, `alternates.canonical` and `robots`, all driven by `seoConfig`.
- New `app/sitemap.ts` and `app/robots.ts` generated from settings + `GET /seo/sitemap-entries`.
- Product detail page consumes `Product.seoTitle`/`seoDescription` and the store name instead of the hardcoded `– Electrode`; same for the remaining static pages.
- JSON-LD emitted for Organization (root), Product (PDP), Article (blog post) and BreadcrumbList, gated by the Structured Data toggles.
- `seo-config` added to the revalidate tag allow-list so saving in admin refreshes the storefront.

**Not breaking**: `StoreSetting.siteUrl` / `metaTitle` / `metaDescription` keep their column names and meaning; only the admin screen that edits them moves.

## Capabilities

### New Capabilities

- `seo`: Centralized SEO configuration — a single admin surface owning global SEO defaults, indexing/robots policy, sitemap generation, structured data, search-engine verification, and per-record meta overrides across all content types, plus the storefront rendering contract that consumes it.

### Modified Capabilities

<!-- openspec/specs/ is currently empty; there are no existing capability specs to modify. -->

None — `openspec/specs/` contains no existing capabilities.

## Impact

**Server** (`server/`)
- `prisma/schema/StoreSetting.prisma` — add `seoConfig Json?` (additive migration, no data backfill required).
- `src/app/module/store-setting/` — `validation.ts` (new `seoConfigZodSchema`), `interface.ts`, `constant.ts` (`DEFAULT_SEO_CONFIG`), `service.ts` (merge into public projection).
- New module `src/app/module/seo/` (`seo.route.ts`, `seo.controller.ts`, `seo.service.ts`) mounted at `src/app/routes/index.ts` as `/seo`.
- `src/app/module/product/product.validation.ts` and `category/category.validation.ts` already accept the SEO fields — no change; only the admin UI is missing.
- `src/app/utils/revalidateStorefront.ts` — fire the `seo-config` tag on settings save.

**Admin** (`admin/`)
- `src/routes/nav-config.ts` — new `SEO` `NavSection`.
- `src/routes/app-router.tsx` — five lazy routes under `/seo/*`.
- New `src/features/seo/` built on the existing `useSettingsDraft` / `ResourceListPage` patterns.
- New `src/lib/api/seo.ts`; `src/lib/api/query-keys.ts` gains `seo` keys.
- `src/features/ui/site-settings/site-settings-page.tsx` — remove the SEO card (L294-330).
- `src/features/catalog/**/product-form-page.tsx` and `category-form-page.tsx` — add the missing SEO fields.

**Storefront** (`nextjs/`)
- `src/app/layout.tsx`, new `src/app/sitemap.ts`, `src/app/robots.ts`.
- `src/services/store-settings.ts` — extend types + `FALLBACK_SETTINGS`; new `src/services/seo.ts`.
- New `src/components/seo/json-ld.tsx`.
- `src/app/api/revalidate/route.ts` — allow the `seo-config` tag.
- Metadata touch-ups across ~13 `(shop)` pages that currently hardcode `– Electrode`.

**Dependencies**: none added. No third-party SEO library — Next.js 16 App Router metadata API is sufficient.

**Risk**: low. All schema changes are additive; the storefront falls back to current behavior when `seoConfig` is null.
