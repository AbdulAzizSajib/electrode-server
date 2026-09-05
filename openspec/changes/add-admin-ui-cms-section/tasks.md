## 1. Server — Page model and module

- [x] 1.1 Add `prisma/schema/Page.prisma`: `id`, `title`, `slug` (`@unique`), `body` (Text), `metaTitle?`, `metaDescription?`, `status` (`PageStatus @default(DRAFT)`), `sortOrder`, `createdAt`, `updatedAt`; index on `status`
- [x] 1.2 Add `PageStatus { DRAFT PUBLISHED }` to `prisma/schema/enums.prisma`
- [x] 1.3 Run `pnpm -C server migrate` to create the migration, and `pnpm -C server generate`
- [x] 1.4 Create `src/app/module/page/page.constant.ts` with `RESERVED_SLUGS` (`account`, `api`, `blogs`, `cart`, `checkout`, `compare`, `contact`, `deals`, `gift-cards`, `products`, `track-order`, `wishlist`, `admin`, `_next`) and a comment pointing at `frontend/src/app/` as the source to keep it in step with
- [x] 1.5 Create `page.validation.ts`: slug regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, reserved-slug refinement, non-empty body, length caps on title/meta fields; create and update (partial) schemas
- [x] 1.6 Create `page.interface.ts` and `page.service.ts`: admin list (search by title/slug, filter by status, paginated), admin get by id, get published by slug, create, update, delete; slug auto-derived from title when omitted; duplicate slug surfaced as a named conflict error; audit-log every mutation via `AuditLogService.record` like `store-setting.service.ts` does
- [x] 1.7 Create `page.controller.ts` and `page.route.ts`: `GET /pages/admin`, `GET /pages/admin/:id`, `GET /pages/reserved-slugs`, `POST /pages`, `PATCH /pages/:id`, `DELETE /pages/:id` behind `checkAuth(OWNER, ADMIN)`; public `GET /pages` (published list, for link pickers) and `GET /pages/:slug` (published only) — literal segments registered before `/:slug`
- [x] 1.8 Mount `PageRoutes` at `/pages` in `src/app/routes/index.ts`
- [x] 1.9 Seed `DEFAULT_PUBLIC_SETTINGS` in `store-setting.constant.ts` with the storefront's current live values — `mainNav` from `content.ts`'s `navLinks`, `footerColumns` converted to `{label, href}` with real targets, `announcementBar` text/links and the WhatsApp + email values from `content.ts`'s `contact` — so the storefront looks identical when it switches data source
- [x] 1.10 Add the Page requests to `server/postman/Ecom.postman_collection.json` and confirm `pnpm -C server verify:postman` passes
- [x] 1.11 `pnpm -C server lint` and `pnpm -C server build` clean

## 2. Admin — UI section scaffolding

- [x] 2.1 Add a `UI` section to `src/routes/nav-config.ts` with children Pages, Home Slider, Banners, Header Links, Footer Links (`roles: ['OWNER','ADMIN']`, one icon per leaf as the file's convention requires); remove `Banners` from the `Marketing` section
- [x] 2.2 Move `src/features/marketing/banners/` to `src/features/ui/banners/`, updating `BANNERS_PATH` to `/ui/banners` and all imports
- [x] 2.3 Register `/ui/*` routes in `src/routes/app-router.tsx` and add `Navigate` redirects from `/marketing/banners` and `/marketing/banners/:bannerId` to their `/ui/banners` equivalents
- [x] 2.4 Filter `HERO_SLIDER`/`HERO_SIDE`/`HERO_PROMO` out of the banner list page and its placement filter, and add a link across to the Home Slider manager

## 3. Admin — Pages CRUD

- [x] 3.1 Create `src/lib/api/pages.ts` following `banners.ts`'s shape: `PAGE_STATUSES` const array, `Page`/`PageInput` types, list/get/create/update/delete, `useReservedSlugs`, and the `usePages`/`usePage`/`useCreatePage`/`useUpdatePage`/`useDeletePage` hooks
- [x] 3.2 Add `pages: { all, list, detail }` to `src/lib/api/query-keys.ts`
- [x] 3.3 Build `src/features/ui/pages/pages-list-page.tsx`: table of title, slug, status badge, updated-at; search box, status filter, new/edit/delete actions using `ConfirmDialog`
- [x] 3.4 Build `src/features/ui/pages/page-form-page.tsx`: title, slug field that auto-fills from title until edited by hand, `RichTextEditor` for the body, meta title/description, status select; slug validated live against `useReservedSlugs` with an inline error
- [x] 3.5 Add `@tiptap/extension-image` to the page-body editor configuration so images can be inserted (product descriptions keep the existing configuration untouched)

## 4. Admin — Home Slider manager

- [x] 4.1 Create `src/features/ui/home-slider/hero-slots.ts`: one `HERO_SLOTS` constant holding, per slot, the placement, label, rendered size, recommended upload size, aspect ratio and capacity — the single source for label text, placeholder ratios and warning thresholds
- [x] 4.2 Build `src/features/ui/home-slider/home-slider-page.tsx` laying the slots out as the storefront does: slider on the left, two side tiles in a row top-right, promo tile beneath — each slot at its real aspect ratio, showing current artwork or a proportioned empty placeholder
- [x] 4.3 Render each slot's recommended size as `<width> px × <height> px` plus its ratio beside its upload control
- [x] 4.4 Add a client-side dimension check on file select: warn (never block) when the ratio is off by more than 5% or the image is narrower than the widest size the slot is ever rendered at, naming the expected size
- [x] 4.5 Enforce capacity in the UI — the add action is unavailable for a third side tile or a second promo tile, with an explanation and a replace affordance for the promo
- [x] 4.6 Add an in-place slot editor (dialog or inline panel) for artwork, mobile artwork, link target or linked product, status and schedule window, saving through the existing `useCreateBanner`/`useUpdateBanner` hooks
- [x] 4.7 Add drag-to-reorder for slider slides and for swapping the two side tiles, persisting the result to each banner's `sortOrder`
- [x] 4.8 Badge and dim non-`ACTIVE` slots, and show scheduled slots with their go-live date
- [x] 4.9 Add an "Not shown on the storefront" strip listing hero-placement banners beyond each slot's capacity, with delete and re-slot actions

## 5. Admin — Header Links and Footer Links

- [x] 5.1 Extend `src/lib/api/store-settings.ts` with typed models for `mainNav`, `announcementBar`, `footerColumns`, `socialLinks` and `newsletter` (replacing the opaque `StoreSettingJsonBlock`), mirroring the server's Zod constraints
- [x] 5.2 Build a reusable link-target combobox that offers published CMS pages and known storefront routes while still accepting a free-typed href
- [x] 5.3 Build `src/features/ui/header-links/header-links-page.tsx`: reorderable `mainNav` rows with label + href and a one-level-deep inline children list; announcement bar enable toggle, text field and icon-link rows; per-row validation errors; live preview of the rendered header; unsaved-changes guard
- [x] 5.4 Build `src/features/ui/footer-links/footer-links-page.tsx`: up to six reorderable columns each with a title and `{label, href}` link rows; social-link rows limited to the supported platform enum; newsletter heading/subtext/placeholder/button fields; brand and contact fields (`aboutText`, `copyrightText`, contact email/phone/address); live preview; unsaved-changes guard
- [x] 5.5 Make each editor `PATCH /settings` with only its own disjoint field set — header sends `mainNav` + `announcementBar`, footer sends the rest — so neither clobbers the other
- [x] 5.6 Leave `src/features/settings/store-settings/store-settings-page.tsx` unchanged, and update its `toInput` comment to point at the new editors as where those blocks are now edited
- [x] 5.7 Mirror the server's new Page requests into `admin/postman/Ecom.postman_collection.json`
- [x] 5.8 `pnpm -C admin lint`, `pnpm -C admin test` and `pnpm -C admin build` clean

## 6. Frontend — dynamic chrome

- [x] 6.1 Add `src/types/store-settings.ts` and `src/services/store-settings.ts` — a `revalidate: 300` fetch of `GET /settings/public` that never throws and returns typed defaults on any failure, matching `services/banner.ts`'s shape
- [x] 6.2 Fetch settings in `src/app/layout.tsx` inside the existing `Promise.all` and pass them to `Header` and `Footer`
- [x] 6.3 Rewrite `src/components/layout/Header.tsx` to render `mainNav` and `announcementBar` from props, hiding the announcement strip entirely when disabled, keeping the catalog-driven categories mega menu and the hardcoded "Today's Offers" link as they are
- [x] 6.4 Convert `src/components/layout/Footer.tsx` to a server component (extracting the newsletter form to a small client child) and render `footerColumns` with real hrefs, `socialLinks`, newsletter copy, and the brand/contact block from settings
- [x] 6.5 Update `MobileMenuDrawer.tsx` and `MobileBottomNav.tsx` to take nav and contact values from settings rather than `@/data/content`
- [x] 6.6 Delete `navLinks`, `footerColumns`, `contact` and the `NavLink` interface from `src/data/content.ts`, and confirm no import of them remains

## 7. Frontend — CMS pages

- [x] 7.1 Add `src/types/page.ts` and `src/services/page.ts`: fetch a published page by slug with a 300s revalidate, returning `null` on 404 or any failure, and sanitise the body in the service so the safe path is the default one
- [x] 7.2 Add `img` to `ALLOWED_TAGS` and `src`/`alt`/`width`/`height` to `ALLOWED_ATTR` in `src/lib/sanitize-html.ts`, leaving `ALLOWED_URI_REGEXP` as is
- [x] 7.3 Create `src/app/[slug]/page.tsx` rendering the page title and sanitised body in the site chrome, calling `notFound()` for an unknown or draft slug, with no `generateStaticParams`
- [x] 7.4 Implement `generateMetadata` for the route: meta title falling back to the page title, meta description falling back to a truncated plain-text excerpt of the body
- [x] 7.5 Add `src/app/not-found.tsx` if the project has no root 404 page yet, so an unknown slug lands somewhere styled

## 8. Verification

- [x] 8.1 Add a frontend test asserting that the admin editor's output for every supported formatting (headings, bold, italic, lists, links, images) survives `sanitizeHtml()` unchanged, so the editor and the allow-list cannot drift apart
- [x] 8.2 Add frontend tests for `services/store-settings.ts` and `services/page.ts` covering the failure paths — unreachable endpoint returns defaults, 404 slug returns null
- [x] 8.3 Manually verify the storefront renders identically before and after the chrome switch, against the seeded defaults from 1.9
- [ ] 8.4 Manually verify each hero slot end to end: upload at the stated size, off-ratio warning appears, capacity limits hold, reorder persists, storefront reflects the change after the cache window
- [x] 8.5 Manually verify a page's full lifecycle: create as draft (404s publicly), publish (renders at `/<slug>`), link from a footer column, delete (404s again)
- [x] 8.6 Manually verify a reserved slug such as `cart` is refused with a clear message
- [x] 8.7 Manually verify saving the header editor leaves footer settings intact and vice versa
- [x] 8.8 `pnpm -C frontend lint`, `pnpm -C frontend test` and `pnpm -C frontend build` clean; `pnpm build` at the root passes for all three apps
