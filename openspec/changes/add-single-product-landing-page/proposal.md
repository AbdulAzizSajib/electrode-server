## Why

A merchant running a paid ad campaign for ONE product does not need — and is actively hurt by — a full storefront. Ad traffic that lands on a catalogue browses, compares, and leaves; the Bangladeshi single-product landing page converts because it is one scrollable page ending in a three-field COD order form (নাম / মোবাইল / ঠিকানা) with no cart, no login and no navigation to wander into.

Today this shop can only serve the full site. A merchant who wants to run a campaign has to either send ad traffic to a product page wrapped in header, footer, cart drawer, mobile nav and compare bar, or build a separate site elsewhere and lose every order, stock deduction and report the admin panel already gives them. This change makes the landing page a first-class thing the merchant authors in the admin panel, backed by the same products, stock, orders and COD rules as the rest of the shop.

## What Changes

**Landing pages as an authored entity**

- New `LandingPage` record: one landing page is bound to exactly one product and served at its own URL `/lp/<slug>`. Merchants create as many as they like — one per campaign — so the next campaign can be drafted while the current one runs, and two pages can be A/B tested against the same product.
- New admin menu **UI → Landing Pages**: list, create, edit, duplicate, delete, publish/unpublish.
- Authored content per page: hero headline/subheadline/badge, an ordered media gallery (images **and** video), a rich-text description body, "why buy" highlight bullets, FAQ rows, customer quotes, trust badges, an order-form block, and an after-order thank-you message. Every string is merchant-authored, so a page written in Bangla is Bangla end to end; a newly created page is **seeded with Bangla defaults** (`নাম`, `মোবাইল নম্বর`, `ঠিকানা`, `অর্ডার কনফার্ম করুন`).

**Site mode toggle**

- New store-wide setting `siteMode`, toggled in the admin panel between `WEBSITE` and `LANDING_PAGE`, together with which landing page is the active one.
- In `LANDING_PAGE` mode the storefront root `/` serves the active landing page. **Every other storefront route stays live** — `/products`, `/cart`, `/checkout`, `/track-order`, account and CMS pages all keep working, so flipping the toggle breaks no existing link and is instantly reversible.
- The toggle cannot be switched on without a published landing page selected, and the active landing page cannot be unpublished or deleted while the toggle is on.

**Ordering from the landing page**

- The product is pre-selected on the page: the shopper adjusts quantity, picks a delivery area, fills name/phone/address and submits. No cart, no checkout page, no account.
- Delivery is priced by **per-page delivery zones** the merchant configures — the Bangladeshi `ঢাকার ভিতরে ৳60` / `ঢাকার বাইরে ৳120` radio pair, seeded by default. The shopper's chosen zone price is what the server charges; the storefront never computes money it then asks the server to trust.
- Orders are guest COD, placed through the existing order pipeline: same stock deduction, same order number, same per-phone and per-IP COD abuse caps, same admin order list, same reports.
- Attribution: every landing-page order records which landing page produced it, so campaign performance is answerable from the orders that already exist.

**Not changing**

- Product price stays the single source of price truth. A landing page displays `price` and `compareAtPrice` (the "regular vs offer" pair the merchant already manages on the product) and **cannot** set a price of its own — a second place to author money is how a shop ends up quoting one number and charging another.
- The normal cart/checkout flow, its `checkoutConfig` field rules and its shipping-rule pricing are untouched.
- Optional and easy to drop if unwanted: a per-page Facebook Pixel id (digits only, injected as an id and never as markup) so ad campaigns can measure the conversions the page exists to produce.

## Capabilities

### New Capabilities

- `storefront-cms/landing-pages`: what a landing page is — its content model, admin authoring and lifecycle, and how the storefront renders it at `/lp/<slug>` as a chrome-free document.
- `store-config/site-mode`: the website ↔ single-landing-page toggle, which landing page is active, what `/` serves in each mode, and the invariants that stop the toggle pointing at nothing.
- `commerce/landing-page-orders`: the direct order form — quantity, delivery-zone pricing, guest COD placement through the existing order pipeline, and campaign attribution on the resulting order.

### Modified Capabilities

_None._ `openspec/specs/` is empty — every capability this repo's changes have declared so far is still a pending delta, so the three above are introduced rather than amended. The behaviour this change reuses (guest COD checkout, checkout field config, storefront theming) is left exactly as specified.

## Impact

**Server** (`server/`)

- Prisma: new `LandingPage` model, new `LandingPageStatus` and `SiteMode` enums, new `siteMode` + `activeLandingPageId` columns on `StoreSetting`, new nullable `landingPageId` on `Order`. All additive — an existing install defaults to `WEBSITE` and behaves exactly as it does today.
- New module `src/app/module/landing-page/` (controller, service, route, validation, interface, constant) mounted at `/landing-pages`, with public read, public quote and public order endpoints alongside the admin CRUD.
- `order.service.ts`: the shared checkout core gains an optional shipping override so a landing-page order is charged its zone price instead of being run through `quoteShipping`. No change to any existing caller.
- `store-setting.validation.ts` / `.service.ts`: the two new settings and their invariants; `/settings/public` starts carrying `siteMode` and the active page's slug.
- Postman collection + `verify:postman`, plus a new `verify:landing-page` script following the existing per-change verification convention.

**Admin** (`admin/`)

- New feature folder `src/features/ui/landing-pages/` (list page, form page, section editors), new lazy routes, one new `NAV_SECTIONS` entry under **UI**, new `src/lib/api/landing-pages.ts`.
- The site-mode toggle and active-page selector live at the top of the Landing Pages list — the one screen where "which page is live" is the question being asked.

**Frontend** (`frontend/`)

- **Structural**: existing storefront routes move into an `app/(shop)/` route group so the landing page can live under `app/(landing)/` with its own chrome-free shell. Pure directory move — no URL changes, `app/api/**` stays put. This is the one part of the change that touches files unrelated to landing pages.
- New `/lp/[slug]` route, landing-page section components, `src/services/landing-page.ts`, `src/types/landing-page.ts`.
- `/` redirects to the active landing page when the toggle is on.

**Risk**

- The route-group move touches every storefront route file. Mechanical, but it is where a mistake would be widest, so it is sequenced as its own task with a full-route smoke check.
- Two order-placement paths now exist. They are kept honest by sharing one checkout core rather than by duplicating it — the override is a parameter, not a second implementation.
