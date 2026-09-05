## Why

The storefront's chrome and its legal/informational pages are still hardcoded. `Header.tsx` reads `navLinks` from `src/data/content.ts`, `Footer.tsx` renders `footerColumns` as bare strings pointing at `href="#"`, the newsletter/brand/contact blocks are literal JSX, and pages like Terms & Conditions, Refund Policy and FAQ simply do not exist. A merchant cannot change a menu label, fix a dead footer link, or publish a refund policy without a developer and a redeploy.

The backend is already most of the way there and nobody is using it: `StoreSetting` has validated `mainNav`, `footerColumns`, `socialLinks`, `announcementBar` and `newsletter` JSON columns served by `GET /settings/public`, but the admin panel has no editor for them (`store-settings-page.tsx` explicitly skips them) and the storefront never calls the endpoint. Banners are dynamic but managed through a flat list under **Marketing** that gives no sense of where a banner actually lands on the homepage.

This change adds a dedicated **UI** section to the admin panel that owns everything a merchant sees but a developer currently controls.

## What Changes

### New admin parent menu: **UI**

Five children, replacing the Marketing → Banners entry:

- **Pages** — CRUD for dynamic content pages (About, Terms & Conditions, Refund Policy, FAQ, Contact, etc.) with a rich-text (WYSIWYG) editor, slug, SEO meta, and draft/published status. Served on the storefront at root-level `/<slug>`.
- **Home Slider** — a visual hero manager that mirrors the live storefront layout: one wide slider slot on the left, two square side tiles top-right, one wide promo tile bottom-right. Each slot shows its required artwork dimensions inline (e.g. `1720 × 1290 px`) and edits in place instead of through a generic form.
- **Banners** — the existing banner list, moved under UI, scoped to the non-hero placements (`HEADER`, `MID`, `FOOTER`, `SIDEBAR`, `POPUP`). No capability lost.
- **Header Links** — editor for `mainNav` (labels, hrefs, one level of dropdown children, reorder) and the announcement bar (on/off, promo text, icon links).
- **Footer Links** — editor for `footerColumns` (up to 6 columns of `{label, href}` links), `socialLinks`, `newsletter` copy, and the footer brand/contact block (`aboutText`, `copyrightText`, contact email/phone/address).

### Storefront goes dynamic

- `Header.tsx` and `Footer.tsx` read from `GET /settings/public` instead of `src/data/content.ts`. **BREAKING** for `footerColumns`: the stored shape is `links: [{label, href}]`, while `content.ts` currently holds `links: string[]` — the static export is removed, not adapted.
- New root-level catch-all route renders a published page at `/<slug>`, 404s on an unknown or draft slug.

### Server

- New `Page` model + `/pages` module (admin CRUD, public read-by-slug), with slug uniqueness and a reserved-slug guard so a page can never shadow an existing storefront route.
- No schema change for navigation — `StoreSetting` already carries every column this needs.

## Capabilities

### New Capabilities

- `storefront-cms/pages`: Merchant-authored content pages — authoring, slug rules, publish state, and how the storefront resolves `/<slug>`.
- `storefront-cms/home-hero`: Managing the homepage hero's three slot types as a layout, including per-slot capacity and artwork dimension guidance.
- `storefront-cms/navigation`: Header and footer chrome driven by stored settings — main nav, announcement bar, footer columns, social links, newsletter and the footer brand/contact block.

### Modified Capabilities

None. The root `openspec/specs/` tree is currently empty and the server's `api/marketing` spec keeps its existing banner requirements unchanged — the Home Slider manager is a new admin surface over the same endpoints, not a change to how banners are stored or served.

## Impact

**Server** (`server/`)
- `prisma/schema/Page.prisma` (new model) + migration
- `src/app/module/page/` (new module: route, controller, service, validation, interface)
- `src/app/routes/index.ts` — mount `/pages`
- `postman/Ecom.postman_collection.json` — new Page requests

**Admin** (`admin/`)
- `src/routes/nav-config.ts` — new `UI` section; `Banners` leaves `Marketing`
- `src/routes/app-router.tsx` — `/ui/*` routes, redirect `/marketing/banners` → `/ui/banners`
- `src/features/ui/` (new): `pages/`, `home-slider/`, `header-links/`, `footer-links/`; banners move from `src/features/marketing/banners/`
- `src/lib/api/` — new `pages.ts`; `store-settings.ts` extended to write the JSON blocks
- `postman/Ecom.postman_collection.json` — kept in sync with server
- No new dependency: `RichTextEditor` (Tiptap) already exists at `src/components/forms/rich-text-editor.tsx`

**Frontend** (`frontend/`)
- `src/app/[slug]/page.tsx` (new catch-all for CMS pages)
- `src/components/layout/Header.tsx`, `Footer.tsx` — settings-driven
- `src/services/store-settings.ts`, `src/services/page.ts` (new)
- `src/data/content.ts` — `navLinks`, `footerColumns`, `contact` removed
- No new dependency: `sanitizeHtml()` already exists at `src/lib/sanitize-html.ts` (needs `img` added to its allowlist)

**Cross-cutting**
- This change lives in the root `openspec/` because it spans all three repos; the per-repo `openspec/` roots are untouched.
