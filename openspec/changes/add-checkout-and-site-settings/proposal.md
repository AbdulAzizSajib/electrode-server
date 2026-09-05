## Why

A merchant still cannot change how their own site looks or what their checkout asks for. The storefront's palette, typeface and container width are literals in `frontend/src/app/globals.css`, compiled into the bundle; the site's `<title>` and description are a hardcoded object in `frontend/src/app/layout.tsx` that reads `"Electrode - Electronics Store"` while the seeded store is called *Gadgets Mart*; and there is no footer logo, no canonical site URL, and no SEO defaults anywhere in the data model. Changing a brand colour is a developer task and a redeploy.

Checkout is the same story in a costlier place. `CheckoutForm.tsx` asks a fixed set of questions, always shows the order-note box, always allows guest ordering, and offers no coupon box at all (the only one lives on the cart page). A merchant who wants to stop collecting postal codes, or who wants to require sign-in, has no way to say so.

The **UI** section added by `add-admin-ui-cms-section` already owns "everything the shopper sees but a developer used to control". These are the two remaining pieces of that.

## What Changes

### Two new children under the admin **UI** menu

**Checkout Setting** — one page controlling what the checkout page asks customers for.

- A field table with **Show on checkout** and **Required** per row, covering the fields checkout actually has today: Customer name, Mobile number, Address, Apartment/floor, City, Postal code.
- Three switches: show the coupon code box, show the order note box, allow guest checkout.
- A free-text notice rendered above the Place Order button.
- **Email is deliberately not in the table.** The mockup showed it, but email does not exist on the checkout form, in `createOrderZodSchema`, or on the `Order` model — a toggle for it would control nothing. Adding email capture is left as its own change.
- **The server honours these settings.** Guest-order validation in `order.service.ts` reads the stored config, so a field the merchant marks optional is genuinely optional rather than a form that passes and an API that 400s. Two floors are non-negotiable and are locked in the admin UI with an explanation:
  - **Mobile number** can be neither hidden nor made optional — guest order lookup (`/orders/guest`) and the per-phone COD abuse limit are both keyed on it.
  - **Allow guest checkout = off** is enforced on both sides: the storefront sends guests to sign-in, and the server rejects a guest order with 401 rather than trusting the client.
- **New**: a coupon box on the checkout page, reusing the existing `CouponForm`. The switch governs both it and the cart page's, so the two cannot disagree.

**Site Setting** — one page owning the storefront's identity and theme.

- Header logo and footer logo, both file uploads through the existing `POST /uploads/image`.
- Site name (+ its existing accent half), site URL, meta title, meta description, copyright text.
- **Font setting**: the merchant pastes what Google Fonts hands them — the `@import url(…)` line, the `<link>` tag, or the bare `https://fonts.googleapis.com/css2?…` URL. The server parses the family name and stylesheet URL out of it and stores those two values. The pasted text is never stored or echoed verbatim, and a URL whose host is not exactly `fonts.googleapis.com` is rejected.
- **Site colours**: all six tokens currently hardcoded in `globals.css` — `--background`, `--foreground`, `--color-brand`, `--color-brand-dark`, `--color-accent`, `--color-sale`.
- **Site max width**: the container width, today the literal `max-w-346` repeated across 23 call sites in 16 files.

### Storefront goes dynamic

- The root layout emits a `<style>` block setting the six colour tokens, `--font-sans` and `--site-max-width` on `:root`, plus a `<link>` to the merchant's font stylesheet. The values in `globals.css` stay as the fallbacks. The `@theme inline` block is untouched — it already maps every one of these vars into Tailwind, so every existing `bg-brand` / `text-sale` / `font-sans` usage picks up the merchant's values with no call-site change.
- The hardcoded `metadata` export in `layout.tsx` becomes `generateMetadata()`, reading meta title, description and `metaBase` from settings.
- `max-w-346` is replaced by a `.site-container` utility driven by `--site-max-width` at all 23 call sites.

### Admin: branding moves out of Store Settings

**BREAKING (admin UI only, no data change)**: Settings → Store Settings loses its Branding block — `storeName`, `siteNameAccent`, `logoUrl`, `aboutText`, `copyrightText` now live on UI → Site Setting. The same columns are written by the same endpoint; only the editing surface moves, so one field has one home. Store Settings keeps commerce configuration: currency, tax rate, free-shipping threshold, COD abuse limits and contact details.

## Capabilities

### New Capabilities

- `storefront-cms/checkout-config`: What the checkout page asks a customer for — per-field visibility and requiredness, the coupon/note/guest switches, the pre-submit notice, the floors that cannot be configured away, and the rule that the server validates against the same config the form renders from.
- `storefront-cms/site-identity`: The store's identity and SEO surface — header and footer logos, site name, canonical site URL, meta title and description, and copyright text, including which of these the public settings projection exposes.
- `storefront-cms/theming`: Merchant-controlled presentation — the six colour tokens, the Google Fonts typeface (including how a pasted embed is parsed and what makes one acceptable), and the container max width, plus how each reaches the storefront and what happens when one is unset.

### Modified Capabilities

None. `openspec/specs/` at this root is still empty — `add-admin-ui-cms-section` declared `storefront-cms/pages`, `home-hero` and `navigation` but was never synced or archived, so there is no existing requirement here to amend. The server's `api/checkout` spec keeps its requirements unchanged: guest-order validation gains a configurable layer above its existing floor, and the floor itself (phone required, COD-only, rate-limited) is exactly what this change refuses to let a merchant remove.

## Impact

**Server** (`server/`)
- `prisma/schema/StoreSetting.prisma` — new columns: `footerLogoUrl`, `siteUrl`, `metaTitle`, `metaDescription`, `checkoutConfig` (Json), `theme` (Json). Plus a migration.
- `src/app/module/store-setting/store-setting.validation.ts` — `checkoutConfigSchema`, `themeSchema`, the Google Fonts URL parser/guard, hex-colour and max-width validation
- `src/app/module/store-setting/store-setting.constant.ts` — `DEFAULT_CHECKOUT_CONFIG`, `DEFAULT_THEME` (mirroring today's `globals.css` values so nothing shifts on first deploy)
- `src/app/module/store-setting/store-setting.service.ts` — the new columns opted in to the public **allow-list** projection
- `src/app/module/order/order.service.ts` — guest validation reads `checkoutConfig`; guest-checkout-disabled returns 401
- `postman/Ecom.postman_collection.json`

**Admin** (`admin/`)
- `src/routes/nav-config.ts` — two new items under **UI**
- `src/routes/app-router.tsx` — `/ui/checkout-settings`, `/ui/site-settings`
- `src/features/ui/checkout-settings/`, `src/features/ui/site-settings/` (new)
- `src/features/settings/store-settings/store-settings-page.tsx` — Branding block removed
- `src/lib/api/store-settings.ts` — new types and input fields; `src/lib/api/uploads.ts` — image upload hook
- `postman/Ecom.postman_collection.json`

**Frontend** (`frontend/`)
- `src/app/layout.tsx` — `generateMetadata()`, theme `<style>`, font `<link>`
- `src/app/globals.css` — `.site-container`; existing `:root` values become documented fallbacks
- `src/components/checkout/CheckoutForm.tsx` — settings-driven fields, notice, coupon box, guest gate
- `src/app/checkout/page.tsx`, `src/app/cart/page.tsx` — pass settings through
- `src/services/store-settings.ts`, `src/types/store-settings.ts` — new blocks + fallbacks
- 16 files replacing `max-w-346` with `.site-container`
- `postman/Ecom.postman_collection.json`

**Cross-cutting**
- All three Postman collections stay in sync with the endpoint changes; `pnpm -C server verify:postman` must pass.
- No new dependency in any of the three apps.
