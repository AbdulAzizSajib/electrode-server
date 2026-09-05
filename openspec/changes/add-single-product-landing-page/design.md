## Context

See proposal.md — Why. What follows is only the existing shape the design has to fit.

The shop is three deployables against one Postgres: `server/` (Express + Prisma, module-per-domain under `src/app/module/`), `admin/` (React + React Router, feature-per-folder under `src/features/`), `frontend/` (Next.js App Router).

Four existing facts constrain almost every decision below:

1. **Guest COD checkout already exists.** `POST /orders` takes `optionalAuth`, accepts inline `items` for a shopper who never touched the cart (`frontend/src/lib/guest-checkout.ts` already uses this for "buy this one product" from a product page), resolves a guest onto a `Customer` by phone, validates Bangladeshi mobile numbers, enforces per-phone and per-IP COD caps, deducts stock in a transaction, creates a PENDING COD `Payment`, and supports an `Idempotency-Key`. A landing page order is that flow with a different form in front of it.

2. **Pricing has exactly one implementation, deliberately.** `order.pricing.ts` computes tax per product rule and delivery per matched `ShippingPlace`, and its header says why: "A second implementation of 'what does this cost' is how a storefront ends up quoting one number and charging another." Any landing-page pricing must go through it or extend it, never beside it.

3. **`StoreSetting` is a singleton whose JSON columns are gated only by Zod.** The model's own doc-comment states that `store-setting.validation.ts` is the ONLY gate on their shape and that no code path may persist an unvalidated value. Public reads merge over `DEFAULT_PUBLIC_SETTINGS` so a cleared column still renders a usable site. The storefront reads `/settings/public` in its root layout with a 30-second revalidate and a `store-settings` cache tag the backend pings on save.

4. **The storefront's root layout unconditionally renders the chrome.** `frontend/src/app/layout.tsx` renders `Header`, `Footer`, `CartDrawer`, `CartRail`, `MobileBottomNav` and `CompareBar` around every route. There is one root layout and every route is under it.

## Goals / Non-Goals

**Goals**

- One landing page = one product = one URL, with as many landing pages as the merchant wants.
- The landing page order path and the normal checkout path share one order-creation core and one pricing module.
- Switching the toggle is reversible with no other observable consequence, and cannot leave the storefront root broken.
- Everything the shopper reads is merchant-authored, so "Bangladeshi style" is a matter of the seeded defaults rather than a hardcoded locale.

**Non-Goals**

- A page builder. Sections are a fixed set with authored content, not arbitrary drag-and-drop blocks — the same line `Page` drew (see `Page.prisma`).
- Per-landing-page pricing, discounts or coupons. See Decision 2.
- Landing-page-specific analytics beyond order attribution and an optional pixel. The existing reports already answer revenue questions once orders carry the attribution.
- Multi-product landing pages, upsells and order bumps.
- A/B split routing. Two pages for one product is supported because slugs are independent; deciding which visitor sees which is the ad platform's job, not this system's.

## Decisions

### 1. `LandingPage` is its own model, not a `Page` and not a `Campaign`

`Page` is explicitly "a title and one rich-text body, nothing more" and its slug is a top-level storefront segment. `Campaign` is a discount schedule with an optional storefront placement — it prices products, it does not render. A landing page is a structured, product-bound document with an order form, so it is neither.

**Alternatives considered.** Extending `Page` with a `type` discriminator and a JSON blob: it would put an order form inside a model whose whole documented point is that it has no structure, and would make `/about` and a campaign page the same kind of thing. Extending `Campaign`: a campaign is a discount, and landing pages deliberately do not discount (Decision 2).

Content that is a list of similar rows — gallery items, highlights, FAQs, quotes, trust badges, delivery zones, order-form field config — is stored in Zod-validated `Json` columns, exactly as `StoreSetting.mainNav`, `footerColumns`, `checkoutConfig` and `theme` already are. The same rule carries over verbatim: **the Zod schemas are the only gate, every write goes through them, and no other code path may persist an unvalidated value.** Scalars that are queried, sorted or uniquely constrained (`slug`, `status`, `productId`, `facebookPixelId`) stay real columns.

The rich-text `bodyHtml` is stored **as authored and not sanitised on write**, and sanitised where it meets a browser — the posture `Page.body` and `Product.description` already take, for the reason stated there: sanitising only on write leaves everything already stored, or written by any other path, trusted forever. The storefront's `src/lib/sanitize-html.ts` is the gate.

### 2. The product is the only place a price is authored

A landing page renders `Product.price` and `Product.compareAtPrice` and has no price field. A merchant running "রেগুলার ৳1500 → অফার ৳990" sets exactly those two fields on the product, which is what they already mean.

**Alternatives considered.** A `campaignPrice` on the landing page: it creates a second authored price, and then every reader — cart, normal checkout, reports, the order pipeline — has to know which one wins and when. That is precisely the failure the codebase removed `StoreSetting.defaultTaxRatePercent` to avoid ("a merchant reading their Tax Rules list was not reading every tax their shop charged"). Reusing a `Campaign` discount: possible later without changing anything here, because the landing page reads whatever price the pricing core produces.

**Consequence to accept:** a merchant who wants a different price for the campaign changes the product's price, and the product page changes too. That is the correct behaviour for a shop with one catalogue, and it is documented on the admin screen.

### 3. Delivery zones live on the landing page and bypass `quoteShipping`

The landing page carries `deliveryZones: [{ key, label, price }]` (1–5 rows, seeded `ঢাকার ভিতরে` 60 / `ঢাকার বাইরে` 120). The shopper picks one; the server charges that zone's stored price.

This has to bypass `quoteShipping`, not extend it. `quoteShipping` matches a `ShippingPlace` by `country`/`state` and **throws** when a product carries no shipping rule or when no place matches — a landing page has neither a country/state input nor any guarantee the merchant configured a rule. Mapping zones onto synthetic `ShippingPlace` rows was considered and rejected: it would make a merchant's zone edit silently rewrite a shipping rule that the normal checkout also prices from.

Mechanically: `order.pricing.ts` gains an optional `shippingOverride: { amount, label }` on `IChargeQuoteInput`. When present, `quoteCharges` skips `quoteShipping` entirely and returns that amount. Tax is still `quoteTax` over the product's own rule, unchanged. `order.service.ts` threads the override through the shared checkout core. **No existing caller passes it, so no existing behaviour moves.**

Two waivers are deliberately not applied under an override: the shop's `freeShippingThreshold` and a coupon's `freeShipping`. The page told the shopper "ডেলিভারি চার্জ ৳60"; charging 0 because an unrelated shop-wide threshold happened to be crossed would make the page a liar in the shopper's favour and the merchant's expense. Landing pages have no coupon box at all, so the second is moot but is closed explicitly.

### 4. The zone label is recorded on the order's shipping address `state`, and the landing page id is a real column

Two facts have to survive on the order: **which campaign produced it** and **which delivery area the shopper chose**.

- **Which campaign** becomes `Order.landingPageId` — a nullable FK with `onDelete: SetNull`, plus `Order.landingPageTitle` captured at placement. The id drives the joinable per-page order count and revenue; the captured title is what keeps a deleted page's orders readable, which is what the spec requires. Attribution is a genuinely new fact nothing else in the system can reconstruct, so it earns a column.
- **Which area** is written into the created guest `CustomerAddress.state`. It is literally the delivery region the shopper declared, `state` is documented as exactly that, the admin order detail already renders it, and the courier-facing views get it for free. The trade-off: `state` is also `quoteShipping`'s matching input, so a landing-page address carries a value that would match nothing if it were ever re-quoted through the normal path. Nothing re-quotes a placed order, and landing-page orders never enter `quoteShipping` — but this is the one place where a later feature could be surprised, so it is called out here and in the schema doc-comment.

**Alternative considered:** a dedicated `Order.deliveryZoneLabel` column. Rejected as a second address-ish field that every order view would have to learn about, to hold a string the address already has a field for.

### 5. `siteMode` and `activeLandingPageId` go on the `StoreSetting` singleton

`siteMode` is a `SiteMode` enum column (`WEBSITE` | `LANDING_PAGE`, default `WEBSITE`); `activeLandingPageId` is a nullable FK. Both are shop-wide singleton facts, which is what that row is for, and putting them there means the storefront learns the mode from the settings payload it **already fetches in its root layout on every page** — no second request, no second cache.

Invariants are enforced in the service layer, not in Zod, because each needs a database read the validator cannot do:

- entering `LANDING_PAGE` requires `activeLandingPageId` to resolve to an existing `PUBLISHED` page;
- unpublishing or deleting the active page while in `LANDING_PAGE` mode is rejected;
- deleting the active page while in `WEBSITE` mode succeeds and nulls the pointer (`onDelete: SetNull`), which then blocks the next attempt to switch on.

Both the mode change and the status change are checked inside one transaction that re-reads the counterpart row, so two admins racing cannot land in mode-on-with-draft-page.

`/settings/public` starts returning `siteMode` and `activeLandingPage: { slug, title } | null`. `DEFAULT_PUBLIC_SETTINGS` gains `siteMode: "WEBSITE"` and `activeLandingPage: null`, so an unreachable or unseeded settings read yields a normal website — the spec's required fallback, and the safe direction to fail in.

### 6. The storefront gets two shells via route groups, and `/` redirects rather than rewrites

The landing page must render with no header, footer, cart drawer, compare bar or mobile nav. Today there is one root layout and it renders all of them.

**Chosen:** split into route groups. `app/layout.tsx` shrinks to the html/body/providers shell; every existing storefront route moves under `app/(shop)/` with the chrome layout; the landing page lives at `app/(landing)/lp/[slug]/page.tsx` with a chrome-free layout. Route groups do not affect URLs, so this is a pure directory move. `app/api/**` stays where it is — route handlers have no layout.

**`/` in `LANDING_PAGE` mode issues a redirect to `/lp/<active-slug>`** from `app/(shop)/page.tsx`, which already awaits the settings it needs.

**Alternatives considered.**
- *Middleware rewrite of `/` → `/lp/<slug>`:* keeps the URL as `/`, but middleware would have to learn the active slug on every request — either an origin fetch per request at the edge or a second cache with its own staleness. Rejected as a per-request cost on every route to save one hop on one route.
- *Rendering the landing page component from `app/page.tsx`:* the root layout's chrome would still wrap it, which is the one thing that must not happen.
- *Hiding the chrome with CSS or a client context:* ships the chrome's markup, its data fetches and its JavaScript to a page whose entire purpose is to be a single focused document.

**Consequence to accept:** ad traffic to the bare domain takes one extra hop, and the landing page's canonical URL is `/lp/<slug>` in both modes. Both are fine — one canonical URL per campaign is what an ad platform and an analytics tool both want anyway.

The `/` page is cached with the same `store-settings` tag the layout uses, so the redirect appears and disappears when the merchant saves the toggle, on the existing revalidation path.

### 7. Totals come from a server quote endpoint, never from client arithmetic

The landing page needs a live total as the shopper changes quantity and zone. Tax is per-product-rule; reimplementing `quoteTax` in the browser is the exact "second implementation" the pricing module forbids.

So the public surface is three endpoints, mirroring how `/orders` and `/orders/quote` already pair:

| Endpoint | Purpose |
| --- | --- |
| `GET /landing-pages/by-slug/:slug` | The published page's content plus a product snapshot (name, price, compareAtPrice, availability, images) |
| `POST /landing-pages/by-slug/:slug/quote` | `{ quantity, zoneKey }` → `{ subtotal, taxAmount, shippingAmount, totalAmount }` |
| `POST /landing-pages/by-slug/:slug/order` | Places the order; takes `Idempotency-Key`; carries `expectedTotal` |

The literal `by-slug` segment keeps the public routes from colliding with the admin `/:id` routes, the same discipline `/settings/public` and `/orders/track` already use.

`expectedTotal` reuses the existing mismatch guard in `order.service.ts`, which already renders its message in the merchant's currency format — so a price that changed between page load and submit is reported, not silently charged.

**Corrected during implementation.** The order route was first built with `optionalAuth`, mirroring `/orders`, so a signed-in visitor's campaign order would attach to their session. That was wrong twice over. It made the page behave differently for the merchant testing it (usually signed in) than for the ad traffic it exists for — which surfaced as a real bug, because the shared checkout core only stored an inline address on its GUEST branch and silently discarded the address a signed-in visitor typed, committing the order with none at all. It also quietly exempted those orders from the per-IP COD cap.

A landing page has no login, no account menu and no address book, so there is no authenticated experience to honour: the route now takes no auth middleware and always places a guest order. Nothing is lost, because the guest path resolves the customer BY PHONE — an order from a number that already has an account still attaches to it, which is exactly what `commerce/landing-page-orders` describes ("attached to that customer AND recorded as a guest order").

The address rule was fixed separately and more fundamentally: `createInlineShippingAddress` is now shared by both actor branches, because the rule is about the address, not the session — an inline address supplied without a saved-address id is the only address that order has, whoever sent it. That removes the branch that could discard one, rather than merely routing around it.

The quote is debounced client-side and the submit button uses the last confirmed quote; a submit that races an in-flight quote is caught by `expectedTotal` rather than by client-side sequencing.

### 8. The landing-page order form has its own required-field rule

`checkoutConfig` governs the normal checkout's six fields and enforces that `phone` can never be hidden or optional. The landing page asks for three things — name, phone, address — and must not inherit a shop whose checkout requires city and postal code, because the page has no such inputs.

So the landing page carries its own `orderForm` config: authored label/placeholder/helper per field, and a single `nameRequired` switch. Phone and address are structurally always present and always required — phone because the per-phone COD cap and guest order lookup are both keyed on it (and `order.service.ts` re-checks it independently, so a row edited outside the API cannot disable it either), address because a COD parcel with no address cannot be delivered. The Zod schema rejects any attempt to spell otherwise.

The submitted address maps to `shippingAddress.addressLine1`; the zone label to `shippingAddress.state` (Decision 4); `country` is set to the shop's own. `city` and `postalCode` are left null, which the address model already permits.

The landing-page order service therefore does **not** call `collectMissingCheckoutFields` — that function reads `checkoutConfig`, which does not govern here. The shared core is entered below that gate. This is the one place where the two order paths deliberately differ, and it is the reason the override is threaded into the core rather than the landing page calling `POST /orders`.

### 9. The Facebook Pixel id is an id, never markup

`facebookPixelId` is a plain column validated `/^\d{5,20}$/`. The storefront renders the standard pixel bootstrap with the id **interpolated as a JSON-encoded string into a script it wrote itself** — merchant input never reaches the page as markup, a tag, a URL or a script body. This is the same posture `theme.font.url` takes, where the URL is rebuilt from validated components and "is never a substring of merchant input".

Only two events fire: `PageView` on load and `Purchase` on a confirmed order, with the order's total and currency. No custom event authoring — that is a script-injection surface with no bounded shape.

### 10. Admin: one feature folder, one nav entry, toggle on the list page

`src/features/ui/landing-pages/` with a list page and a sectioned form page, lazily routed like every other feature. One `NAV_SECTIONS` entry under **UI** (`Landing Pages` → `/ui/landing-pages`), role-gated `OWNER`/`ADMIN` like the rest of that section.

The site-mode toggle and the active-page selector sit in a banner at the top of the Landing Pages list, not on Site Settings. "Website or landing page?" and "which landing page?" are one decision, and splitting them across two screens is how a merchant ends up with the toggle on and the wrong page live. The Site Settings screen gains a read-only line stating the current mode with a link here, so the setting is still discoverable where a merchant would look for it.

The form is sectioned (Basics · Hero & media · Content · Social proof · Order form · After order · SEO & tracking) using the existing `resource-form-layout` and `settings-editor` primitives, so it looks like the rest of the admin panel rather than a new kind of screen.

## Risks / Trade-offs

- **The route-group move touches every storefront route file.** → It is a pure directory move with no URL change, sequenced as its own task ahead of any landing-page work, verified by loading every top-level route before the feature is built on top of it. Rollback is `git mv` back.
- **Two order-placement paths now exist.** → They share one core and one pricing module; the only divergence is the field-requirement gate (Decision 8), stated once and covered by the verification script. A second copy of order creation would have been the real risk, and is what the override parameter avoids.
- **`shippingOverride` could leak into the normal checkout.** → It is optional, no existing caller sets it, and it is reachable only from the landing-page service. The verification script asserts a normal guest checkout still prices delivery from its shipping rule.
- **Zone label in `CustomerAddress.state` is a slightly loose fit.** → Documented in the schema and in Decision 4. The alternative was a column duplicating what the address already models.
- **A merchant expects the landing page to have its own price and it does not.** → This is a real expectation gap, mitigated by saying so on the form beside the price display ("price comes from the product — edit it there"), with a link to the product. Named in the proposal so it can be reconsidered before implementation rather than after.
- **`siteMode` is read from a 30-second-revalidate cache.** → It already carries the `store-settings` tag the backend pings on save, so a save takes effect on the next request; the window only governs a shop nobody is editing. Same guarantee the theme and currency already run on.
- **Landing pages are a new public, unauthenticated, order-creating surface.** → It reuses the same guest COD caps (per phone, per IP per hour) and the same stock transaction as guest checkout, so the abuse ceiling is the shop's existing one rather than a new one. Draft pages are not readable publicly.
- **Merchant-authored rich text on a public page.** → Sanitised at render by the storefront's existing `sanitize-html.ts`, the same gate `Page.body` and `Product.description` already pass through. Not sanitised on write, deliberately and consistently with them.

## Migration Plan

Entirely additive; an existing install is unchanged until a merchant creates a landing page and switches the toggle.

1. **Schema.** One Prisma migration: `LandingPage` table, `LandingPageStatus` and `SiteMode` enums, `StoreSetting.siteMode` (default `WEBSITE`) and `StoreSetting.activeLandingPageId` (null), `Order.landingPageId` (null) and `Order.landingPageTitle` (null). No backfill — every default reproduces today's behaviour exactly.
2. **Server** before admin and storefront, so both have an API to build against.
3. **Storefront route-group move** as an isolated commit, verified on its own before any landing-page route is added.
4. **Admin and storefront landing-page work**, in either order.
5. **Postman collection** updated in the same change as the routes (not after), verified by `pnpm -C server verify:postman`.

**Rollback.** Set `siteMode` back to `WEBSITE` — one field, and the storefront root serves the homepage again on the next revalidation. Landing pages and their orders are untouched by that and can be left in place. A full revert additionally reverses the migration; the new columns are all nullable or defaulted, so dropping them affects no existing row.

## Open Questions

- Whether landing-page orders should be excluded from the "best selling" and "most viewed" product signals, or counted like any other sale. They flow through `PaymentService` and would be counted today. Deferrable: it changes a denormalised counter's semantics, not any interface in these specs, and is better decided once a merchant has run one campaign.
- Whether the merchant wants a shared "landing page" theme (different accent colour, different font) separate from the shop theme. Deferrable — the page inherits the shop theme today, which is the correct default, and a per-page override is additive.
