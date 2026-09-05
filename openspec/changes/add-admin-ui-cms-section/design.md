## Context

See proposal.md — Why. What shapes the approach here is how much already exists.

**Already built, unused.** `StoreSetting` carries `mainNav`, `footerColumns`, `socialLinks`, `announcementBar` and `newsletter` as Json columns, each with a strict Zod schema in `store-setting.validation.ts` (one-level nav nesting enforced structurally, footer links as `{label, href}` objects, social platforms as an enum). `GET /settings/public` serves them through an explicit allow-list projection merged over in-code defaults. `PATCH /settings` is a partial upsert. None of this needs to change — the header and footer work is admin UI plus storefront wiring.

**Already built, reusable.** Admin has `RichTextEditor` (Tiptap, emitting plain semantic HTML) at `components/forms/rich-text-editor.tsx`, used for product descriptions. Frontend has `sanitizeHtml()` (DOMPurify allow-list) at `lib/sanitize-html.ts`, with the sanitise-on-render-not-on-save policy already reasoned through in its header comment. Neither needs a new dependency.

**Genuinely new.** There is no `Page` model, no CMS module, and no storefront route that resolves a merchant-authored slug.

**The mismatch to be careful about.** `frontend/src/data/content.ts` stores `footerColumns` as `links: string[]`, while the server stores `links: [{label, href}]`. `Footer.tsx` currently renders every link with `href="#"` — the static shape is the reason those links are dead. This is a replacement, not an adaptation.

**Hero geometry.** `Hero.tsx` is proportional, not pixel-pinned: inside the content width (less `container-px`'s 64px at `lg`, with `gap-4` between columns) the right column takes **43%** of the row, side tiles are square in a `grid-cols-2 gap-4`, the promo is `aspect-43/20`, and the slider takes the remainder and stretches to the right column's height. Three ratios — 4:3-ish for the slider, 1:1 for a side tile, 2.15:1 for the promo — are where the dimension guidance in the home-hero spec comes from, and they hold at every offered content width.

This was originally derived the other way round, from fixed pixels measured at a single 1384px content width: a `570px` right column, `265 × 275` side tiles, a `265 × 570` promo and a `550px` slider height, giving a `798 × 546` slider. That made the guidance true at exactly one width — a merchant who changed their content width changed only the slider's *width*, so its box changed *shape* under artwork cut for the old one and the banner ended up letterboxed inside empty bands. The proportional layout, and the closed set of content widths that goes with it (see the theming capability), is what replaced it.

## Goals / Non-Goals

**Goals:**
- One admin section that owns everything a merchant sees but a developer currently controls.
- The hero manager communicates *layout*, not rows — a merchant should see which box they are editing.
- Reuse the existing banner endpoints, settings endpoints, editor component and sanitiser rather than adding parallel machinery.
- Removing the static content exports is part of the change, not a follow-up: two sources of truth for nav is the bug.

**Non-Goals:**
- Page versioning, scheduled publishing, drafts-alongside-live, or a preview token. Status is `DRAFT`/`PUBLISHED` and that is all.
- Per-locale content. Single-language, matching the rest of the storefront.
- A page builder with sections and blocks. A page is a title and one rich-text body.
- Making the "Shop By Categories" mega menu or "Today's Offers" configurable — the first is catalog-driven, the second stays hardcoded.
- Restructuring the storefront's banner *rendering*. `Hero.tsx` keeps its current markup; only its data source's management surface changes.

## Decisions

### Hero slots stay `Banner` rows; the layout lives only in the admin UI

The hero manager is a new *view* over the existing `Banner` model and its existing `HERO_SLIDER` / `HERO_SIDE` / `HERO_PROMO` placements. No schema change, no new endpoint, no migration of banner data.

*Why:* the storefront already reads these placements and renders them correctly. A `HeroSlot` model would duplicate `Banner`'s scheduling, status, link-resolution and upload handling, and would force `Hero.tsx` and `services/banner.ts` to be rewritten for no visible gain.

*Alternative considered:* a dedicated `HeroSlot` table with a `slot` enum and a positional index. Rejected — it buys enforced capacity at the database level, which the admin UI can enforce adequately, in exchange for duplicating a model that already works.

*Consequence:* slot capacity (two side tiles, one promo) is a UI constraint, not a database one. Data created before this change, or through the API directly, can exceed it. `Hero.tsx` already truncates (`.slice(0, 2)`, `const [promoTile] =`), so excess renders as nothing rather than breaking the layout — but the hero manager must **show** the overflow rather than hide it, otherwise a merchant sees a banner they cannot find. Overflow items render in an "Not shown on the storefront" strip below the layout, with delete and re-slot actions.

### The banner list keeps the non-hero placements; the hero manager owns the rest

`/ui/banners` filters `HERO_*` out of its list; `/ui/home-slider` owns them exclusively. Each links to the other.

*Why:* a merchant editing the mid-page banner and a merchant arranging the homepage hero are doing different jobs. Showing hero banners in both places invites editing the same row from two surfaces with different capacity rules.

`/marketing/banners` and `/marketing/banners/:id` redirect to the `/ui/` equivalents rather than 404ing — bookmarks and the reference panel's muscle memory both point at the old path.

### Dimension guidance is advisory, ratio checking is client-side and non-blocking

The admin reads the uploaded file's intrinsic dimensions in the browser before upload and compares to the slot's expected ratio (tolerance ±5%) and width. Mismatches produce a warning next to the preview, never a rejected upload.

*Why:* a hard block is wrong here. `object-cover` already handles off-ratio artwork, merchants routinely have a "close enough" asset, and a merchant blocked at 10pm before a sale will find a worse workaround. The warning tells them what will happen; the decision stays theirs.

*Alternative considered:* server-side validation in `banner.validation.ts`. Rejected — the server receives a buffer, so checking dimensions means decoding every upload, and a 422 gives the merchant no preview of the crop.

The stated numbers are 2× what the *widest* offered content width (1600px) renders, so artwork is sharp on high-DPI displays and one upload covers every width:

| Slot | Rendered at 1600px | Recommended upload |
| --- | --- | --- |
| Hero slider | 860 × 645 | **1720 × 1290 px** |
| Hero side tile | 322 × 322 | **644 × 644 px** |
| Hero promo | 660 × 307 | **1320 × 614 px** |
| Mobile artwork | — | **800 × 800 px** |

These live in one `HERO_SLOTS` constant in admin that drives the label text, the placeholder aspect ratio, the warning threshold and the "shows at" figure together — four hardcoded copies of `1720` would drift. The recommended sizes are *derived* from the geometry above rather than typed out, so the guidance cannot fall out of step with the layout the way the original fixed-pixel numbers did.

### Pages resolve at `/[slug]`, with a server-owned reserved list

The storefront gets `app/[slug]/page.tsx`. Next.js gives static segments precedence over dynamic ones, so `/cart` and `/products` keep working regardless — but that precedence is a silent failure for the merchant, who saves a page at `/cart` and never sees it. So the *server* rejects reserved slugs on write and exposes the list at `GET /pages/reserved-slugs` for the admin form to check against as the merchant types.

The reserved set is a constant in the page module, seeded from the storefront's current top-level routes: `account`, `api`, `blogs`, `cart`, `checkout`, `compare`, `contact`, `deals`, `gift-cards`, `products`, `track-order`, `wishlist`, plus `admin` and `_next`.

*Why server-side:* the admin panel and the storefront are separate deployments. A list hardcoded in admin drifts the first time someone adds a storefront route.

*Alternative considered:* `/pages/<slug>`, which needs no reserved list at all. Rejected on the user's instruction — `/refund-policy` is the URL shape merchants and shoppers expect, and it is what the footer links will read.

*Known limitation:* this catches collisions with routes that exist *today*. Adding a storefront route later can still shadow a live page. Mitigated by a note in the reserved-slug constant pointing at `frontend/src/app/`, and by the storefront never 500ing on the collision — the static route simply wins.

### `generateStaticParams` is not used for pages

`app/[slug]/page.tsx` renders on demand with a revalidate window, not pre-rendered from a build-time slug list.

*Why:* pre-rendering needs a build to publish a page, which defeats the purpose of the feature. A revalidate window matching the existing banner/category convention (300s) keeps the cost near zero while making publishing feel immediate enough.

`notFound()` handles both the unknown-slug and draft cases, so a draft is indistinguishable from a non-existent page to a visitor.

### Rich text keeps the existing sanitise-on-render policy

Page bodies go through the same `sanitizeHtml()` the product description uses. `img` is added to its allow-list (with `src`, `alt`, `width`, `height`) because an About page reasonably contains images and a product description did not.

**Corrected during implementation.** This section originally claimed the existing `ALLOWED_URI_REGEXP` would constrain `src` the same way it constrains `href`, and so keep `data:` payloads out. That is false, and a test written against it failed: DOMPurify treats `img` as one of its `DATA_URI_TAGS`, for which a `data:` URI is accepted regardless of the configured regexp. `javascript:` was blocked; `data:image/svg+xml` was not. Adding `img` to the allow-list therefore opened a hole rather than inheriting a guarantee. `sanitize-html.ts` now registers an `afterSanitizeAttributes` hook that re-checks `src` against the same rule `href` gets, and the test asserts both `javascript:` and `data:` are stripped.

The server stores the body as opaque text and does not sanitise on write, matching the reasoning already written into `sanitize-html.ts`: cleaning only on the way in leaves everything already stored trusted forever.

*Consequence:* the admin's Tiptap editor and the storefront's allow-list must not drift. Adding an editor extension that emits a tag the sanitiser strips means a merchant's formatting silently disappears on the storefront. The page form uses the existing editor configuration unchanged, plus the image extension, and nothing else.

### Header and footer editors write disjoint field sets

Two separate admin pages, two separate `PATCH /settings` calls. The header editor sends only `mainNav` and `announcementBar`; the footer editor sends only `footerColumns`, `socialLinks`, `newsletter`, `aboutText`, `copyrightText`, `contactEmail`, `contactPhone`, `address`.

*Why:* `PATCH /settings` is a partial upsert, so disjoint field sets make the two editors non-conflicting for free — the property the existing `store-settings-page.tsx` already relies on, and documents in its `toInput` comment. No optimistic locking needed.

*Consequence for the existing store settings page:* it currently omits these blocks deliberately, to avoid clobbering config it does not show. That comment stays accurate and the page is left alone; contact fields are now editable from two places, which is acceptable because both write the same three columns through the same partial patch.

### The storefront fetches settings once, in the root layout

`layout.tsx` already fetches user and category tree concurrently for the header. Store settings joins that `Promise.all` and is passed to `Header` and `Footer` as props.

*Why:* the header and footer render on every page. Fetching independently in each would double the request; fetching in a client component would flash default chrome before the real nav arrives.

`getStoreSettings()` follows `services/banner.ts`'s shape exactly — a `revalidate: 300` fetch that never throws and returns a typed default on any failure. Chrome that can take down every page on a backend blip is not acceptable, and the pattern for that is already established in this codebase.

`Footer.tsx` is currently `"use client"` only because of its no-op newsletter form. It becomes a server component with the form extracted to a small client child, so it can take settings as props without a client-side fetch.

### Nav and footer editing is list-with-reorder, not free-form JSON

Both editors render typed rows with add/remove/move-up/move-down controls, validated against a client mirror of the server's Zod schema before the request goes out. Nav children are an inline sub-list, one level deep, matching the structural cap the server enforces.

*Why:* a JSON textarea would be a tenth of the work and would put the merchant one comma away from a 422 on their live header. The server's schemas are strict (`.strict()` on nav objects specifically so an over-nested child is a visible error rather than a silent strip) — the admin should surface those errors per-row, at the field, before submit.

Link targets use a combobox that offers published CMS pages and the known storefront routes, and still accepts a free-typed href — so `/refund-policy` is one click, and an external URL is still possible.

## Risks / Trade-offs

**A merchant publishes a page whose slug matches a storefront route added after this change** → The reserved list is server-side and seeded from today's routes; a route added later is not covered. The storefront's static route wins silently rather than erroring, so the failure is "my page 404s", not a broken site. Mitigation is a comment in the reserved-slug constant and adding new top-level storefront routes to it as they land.

**Hero capacity is UI-enforced, so API writes can exceed it** → `Hero.tsx` already truncates, so the storefront cannot break. The hero manager surfaces overflow in a clearly-labelled "not shown" strip so a merchant is never left hunting for a banner they created.

**Deleting the static `navLinks` / `footerColumns` / `contact` exports touches components beyond the header and footer** → `MobileMenuDrawer` and `MobileBottomNav` also consume them. All consumers move to the settings prop in the same change; leaving one behind means the mobile menu and the desktop nav disagree.

**Removing `contact` from `content.ts` changes the WhatsApp and email links in the announcement bar** → Those values move to `announcementBar.links` and the store's contact columns, whose in-code defaults must be seeded with the current live values so nothing changes visibly on deploy.

**Sanitiser and editor drifting apart** → Adding `img` to the allow-list is done in the same commit as adding the image extension to the page editor. A test asserting that the editor's output for each supported formatting survives `sanitizeHtml()` unchanged pins them together.

**Page body HTML is stored unsanitised** → Deliberate, and consistent with product descriptions. The guarantee holds at the render boundary. The risk this accepts is that any *other* future consumer of the page body must sanitise too; `services/page.ts` sanitises in the service, not the component, so the safe path is the default one.

**Two admin surfaces now write contact email/phone/address** → Last write wins, both go through the same partial patch, and both are OWNER/ADMIN-only. Acceptable; the alternative is a cross-link and a merchant hunting for where the footer phone number lives.

## Migration Plan

1. **Server first, independently deployable.** `Page` model + migration + `/pages` module. Nothing consumes it yet; the storefront and admin are unaffected. `/settings` needs no change at all.
2. **Admin second.** New `UI` nav section; banners move with redirects from the old paths. The four new surfaces ship together — a `UI` menu with three of five children wired is worse than not shipping it.
3. **Storefront last**, because it carries the breaking change. `getStoreSettings()` + `Header`/`Footer` rewiring + `app/[slug]` land together with the `content.ts` deletions.

**Seeding is a prerequisite for step 3**, not a follow-up. `DEFAULT_PUBLIC_SETTINGS` must already carry the current live nav, footer columns, announcement text and contact details, so the storefront's appearance is unchanged the moment it switches data source. Deploying step 3 against unseeded defaults means the live header changes without anyone asking for it.

**Corrected during implementation.** The risk turned out to be worse than "unseeded": the settings row was already seeded, by `add-storefront-engagement-apis`, with values that had since drifted from what the storefront rendered — `storeName` "Ecom" against a "Gadgets" wordmark, announcement links pointing at `/contact` instead of `wa.me`/`mailto:`, `contact@example.com` against `contact@sheisite.com`, and a `$10` newsletter heading against the footer's `৳10`. Nothing read those columns, so nothing caught it. Fixing the in-code defaults was not enough, because a stored row wins over them. `scripts/reconcile-storefront-chrome.ts` closes the gap: it rewrites a field only when it still holds the exact old seed value, so a merchant's own edit is detected and left alone, and it is idempotent.

**Rollback:** steps 1 and 2 are additive and roll back by reverting. Step 3 is the risky one — reverting the frontend restores `content.ts` and the static chrome; stored settings are left untouched and are picked up again when it is re-deployed. The `Page` model can stay in place through a frontend rollback; pages simply become unreachable until it returns.
