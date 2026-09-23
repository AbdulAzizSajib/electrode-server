Ordered by dependency: backend storage → backend endpoints → storefront rendering → admin UI → cleanup. Backend and storefront steps are safe to ship before the admin UI exists (see design.md — Migration Plan).

Happy path only, per the request. Tests are limited to the five listed in section 9.

## 1. Schema and SEO config storage

- [x] 1.1 Add `seoConfig Json?` to `StoreSetting` in `server/prisma/schema/StoreSetting.prisma`, with a doc-comment describing the blob shape (matching the convention used by `mainNav`/`checkoutConfig` above it)
- [x] 1.2 Generate and apply the Prisma migration; confirm existing rows get `NULL`
- [x] 1.3 Define `seoConfigZodSchema` in `server/src/app/module/store-setting/store-setting.validation.ts` covering: `siteUrl` reuse, `titleTemplate`, `defaultMetaTitle`, `defaultMetaDescription`, `defaultOgImageUrl`, `twitterCardType`, `twitterSite`, `robots` (`globalNoindex` + `groups` map over the 12 fixed route-group keys, each `{ index, follow }`, + `customRules` string), `sitemap` (per-content-type include booleans), `structuredData` (`organization` fields + `enableOrganization`/`enableProduct`/`enableArticle`/`enableBreadcrumb`), `verification` (`google`, `bing`, `other`)
- [x] 1.4 Wire `seoConfig` into `updateStoreSettingZodSchema` as an optional key (top-level replace, not deep merge — see design.md decision 2)
- [x] 1.5 Add `SeoConfig` to `server/src/app/module/store-setting/store-setting.interface.ts`
- [x] 1.6 Add `DEFAULT_SEO_CONFIG` to `store-setting.constant.ts` — private groups (`account`, `cart`, `checkout`, `wishlist`, `compare`, `search`) default to `{ index: false, follow: false }`; public groups to `{ index: true, follow: true }`; all sitemap types enabled; all structured-data types enabled
- [x] 1.7 Merge `seoConfig` over `DEFAULT_SEO_CONFIG` in the public projection in `store-setting.service.ts`, so `/settings/public` always returns a complete config even when the column is `NULL`

## 2. SEO API module

- [x] 2.1 Create `server/src/app/module/seo/` with `seo.route.ts`, `seo.controller.ts`, `seo.service.ts`, `seo.interface.ts` following the module conventions
- [x] 2.2 Implement `GET /seo/overview` (auth `OWNER`/`ADMIN`) — query Products, Categories, Pages, BlogPosts, LandingPages; normalize `seoTitle`/`seoDescription` and `metaTitle`/`metaDescription` into one `{ id, contentType, title, path, metaTitle, metaDescription, updatedAt }` row shape; support `contentType`, `search`, `page`, `limit` params; paginate in application code
- [x] 2.3 Implement `GET /seo/sitemap-entries` (public, no auth) — published records only, returning `{ contentType, slug, updatedAt }`; honor per-type sitemap toggles and return an empty list when `robots.globalNoindex` is on
- [x] 2.4 Mount the module at `router.use("/seo", SeoRoutes)` in `server/src/app/routes/index.ts`, placed alongside the other literal-segment routes
- [x] 2.5 Add `seo-config` to the revalidation targets in `server/src/app/utils/revalidateStorefront.ts`, and fire both `store-settings` and `seo-config` from the store-setting update service

## 3. Storefront settings plumbing

- [x] 3.1 Extend the settings types and `FALLBACK_SETTINGS` in `nextjs/src/services/store-settings.ts` with `seoConfig`, mirroring `DEFAULT_SEO_CONFIG`
- [x] 3.2 Create `nextjs/src/services/seo.ts` — `SEO_CONFIG_CACHE_TAG = "seo-config"`, plus `getSitemapEntries()` calling `/seo/sitemap-entries` with a longer revalidate window than the settings tag
- [x] 3.3 Add `SEO_CONFIG_CACHE_TAG` to `ALLOWED_TAGS` in `nextjs/src/app/api/revalidate/route.ts`

## 4. Shared metadata resolver

- [x] 4.1 Create `nextjs/src/lib/seo/resolve-metadata.ts` exporting `resolveMetadata({ settings, routeGroup, record?, path })` returning a Next.js `Metadata`: title via template, description, `alternates.canonical`, `openGraph`, `twitter`, `robots`, and `verification` — implementing the record → display → global-default precedence from the spec
- [x] 4.2 Emit no canonical/absolute-URL tags when `siteUrl` is unset; never throw when config is missing (fall back to built-in defaults)
- [x] 4.3 Apply `robots.globalNoindex` as an override that forces `noindex, nofollow` regardless of per-group settings
- [x] 4.4 Define the `RouteGroup` union type shared by the resolver and the route-group robots config

## 5. Storefront metadata rollout

- [x] 5.1 Rewrite `generateMetadata` in `nextjs/src/app/layout.tsx` to delegate to `resolveMetadata`, adding `title.template`, `openGraph`, `twitter`, `robots`, and verification tags
- [x] 5.2 Update the product detail page (`(shop)/products/[handle]/page.tsx`) to use `Product.seoTitle`/`seoDescription` via the resolver, removing the hardcoded `– Electrode`
- [x] 5.3 Update `(shop)/[slug]`, `(shop)/blogs/[slug]`, and `(landing)/lp/[slug]` to route their existing meta fields through the resolver
- [x] 5.4 Replace the hardcoded `– Electrode` static metadata on the remaining `(shop)` pages (products, deals, cart, checkout, checkout/success, wishlist, account and its children, blogs, compare) with resolver calls carrying the correct route group
- [x] 5.5 Add metadata to the pages that currently have none: home, contact, gift-cards, track-order, not-found

## 6. Sitemap and robots

- [x] 6.1 Create `nextjs/src/app/sitemap.ts` — build absolute URLs from `siteUrl` + `getSitemapEntries()`, with `lastModified` per entry; return an empty sitemap when `globalNoindex` is on
- [x] 6.2 Create `nextjs/src/app/robots.ts` — emit disallow rules derived from the route-group config plus `customRules`, and an absolute sitemap link; disallow all when `globalNoindex` is on

## 7. Structured data

- [x] 7.1 Create `nextjs/src/components/seo/json-ld.tsx` — renders `<script type="application/ld+json">`, escapes `<` and `&` in the serialized JSON, renders nothing when passed `null`
- [x] 7.2 Create `nextjs/src/lib/seo/schema-builders.ts` with `buildOrganizationSchema`, `buildProductSchema`, `buildArticleSchema`, `buildBreadcrumbSchema` — each returning `null` when its toggle is off
- [x] 7.3 Mount Organization JSON-LD in the root layout; Product + Breadcrumb on the product detail page; Breadcrumb on category pages; Article on blog post pages

## 8. Admin SEO menu

- [x] 8.1 Create `admin/src/lib/api/seo.ts` — types for `SeoConfig` and overview rows, plus TanStack hooks `useSeoConfig`, `useUpdateSeoConfig` (PATCH `/settings` with the full merged `seoConfig`), and `useSeoOverview`; add `seo` keys to `query-keys.ts`
- [x] 8.2 Add a top-level `SEO` `NavSection` to `admin/src/routes/nav-config.ts` (`roles: ['OWNER','ADMIN']`) with items General, Indexing, Structured Data, Verification, Page SEO under `/seo/*`
- [x] 8.3 Register the five lazy routes in `admin/src/routes/app-router.tsx`
- [x] 8.4 Build `admin/src/features/seo/general/` on the `useSettingsDraft` + `useUnsavedChangesGuard` pattern — canonical site URL, title template, default meta title/description, default OG image, Twitter card type and handle
- [x] 8.5 Build `admin/src/features/seo/indexing/` — global `noindex` switch with a persistent warning banner while enabled, the 12-key route-group index/follow checklist, custom `robots.txt` rules textarea, and per-content-type sitemap toggles
- [x] 8.6 Build `admin/src/features/seo/structured-data/` — organization legal name, logo URL, contact details, social profile URLs, and the four schema-type toggles
- [x] 8.7 Build `admin/src/features/seo/verification/` — Google, Bing, and generic verification token fields
- [x] 8.8 Ensure each sub-screen PATCHes the **full merged** `seoConfig` (fetching fresh config into its draft on mount), never just its own slice — see design.md decision 2
- [x] 8.9 Build `admin/src/features/seo/page-seo/` on `ResourceListPage` — columns for content type, title, path, resolved meta title/description, and a health indicator (missing title, missing description, title too long); content-type filter and search
- [x] 8.10 Add inline SEO editing to the Page SEO rows, dispatching to each resource's existing `PATCH /<resource>/:id` endpoint

## 9. Per-record SEO fields and cleanup

- [x] 9.1 Add SEO title and SEO description fields to the admin product form (`product-form-page.tsx`) — validation already accepts them server-side
- [x] 9.2 Add SEO title and SEO description fields to the admin category form (`category-form-page.tsx`)
- [x] 9.3 Remove the SEO card from `admin/src/features/ui/site-settings/site-settings-page.tsx` (L294-330) — do this last, so the fields are never unreachable between deploys

## 10. Tests

- [x] 10.1 `PATCH /settings` round-trips a `seoConfig` and leaves a sibling blob (e.g. `theme`) untouched
- [x] 10.2 `GET /settings/public` returns a complete config merged over `DEFAULT_SEO_CONFIG` when the column is `NULL`
- [x] 10.3 `GET /seo/overview` returns rows from all five content types
- [x] 10.4 `GET /seo/sitemap-entries` omits unpublished records
- [x] 10.5 Unit test `resolveMetadata()` precedence: record SEO title wins, falls back to display title, falls back to global default, and the title template is applied

## 11. Verification

- [x] 11.1 Run the full monorepo build (`pnpm build`) and confirm all three apps compile
- [x] 11.2 Manually verify end to end: save a default meta description in `SEO → General`, then confirm the storefront serves it without a redeploy
- [x] 11.3 Fetch `/sitemap.xml` and `/robots.txt` and confirm both render with expected content
