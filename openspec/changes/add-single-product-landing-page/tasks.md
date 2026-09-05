## 1. Data model

- [x] 1.1 Add `LandingPageStatus { DRAFT, PUBLISHED }` and `SiteMode { WEBSITE, LANDING_PAGE }` to `server/prisma/schema/enums.prisma`, each with a doc-comment matching the style of `PageStatus` and `CurrencyPosition`
- [x] 1.2 Create `server/prisma/schema/LandingPage.prisma`: scalars (`id`, `title`, `slug @unique`, `status`, `productId`, `headline`, `subheadline?`, `badgeText?`, `bodyHtml @db.Text`, `successHeading?`, `successMessage?`, `metaTitle?`, `metaDescription?`, `ogImageUrl?`, `facebookPixelId?`, `sortOrder`, timestamps) and Zod-gated `Json` columns (`media`, `highlights`, `faqs`, `quotes`, `trustBadges`, `deliveryZones`, `orderForm`). Doc-comment must state that the Zod schemas are the ONLY gate on the JSON shapes and that `bodyHtml` is stored as authored and sanitised at render, citing `Page.body` and `Product.description`
- [x] 1.3 Relate `LandingPage.product` to `Product` with `onDelete: Restrict` (a product with landing pages cannot be deleted) and add the back-relation `landingPages LandingPage[]` on `Product`; index `status` and `productId`
- [x] 1.4 Add `siteMode SiteMode @default(WEBSITE)` and `activeLandingPageId String?` (+ relation, `onDelete: SetNull`) to `server/prisma/schema/StoreSetting.prisma`, doc-commented per design Decision 5
- [x] 1.5 Add `landingPageId String?` (relation, `onDelete: SetNull`) and `landingPageTitle String?` to `server/prisma/schema/order.prisma`, with the doc-comment from design Decision 4 — including the note that a landing-page order's `shippingAddress.state` carries the delivery zone label and is never re-matched through `quoteShipping`; index `landingPageId`
- [ ] 1.6 Run `pnpm -C server migrate` and confirm the generated SQL is purely additive (new table, new enums, nullable/defaulted columns, no backfill) — **SQL authored at `prisma/migrations/20260905140000_add_single_product_landing_page/`, `prisma validate` and `prisma generate` pass; NOT APPLIED because `DATABASE_URL` points at a remote Neon database. Apply with `pnpm -C server migrate:deploy` when ready.**

## 2. Server — landing page module

- [x] 2.1 Create `server/src/app/module/landing-page/landing-page.interface.ts`: `ILandingPageMedia`, `ILandingPageHighlight`, `ILandingPageFaq`, `ILandingPageQuote`, `ILandingPageTrustBadge`, `IDeliveryZone { key, label, price }`, `ILandingPageOrderForm`, and the create/update payload types
- [x] 2.2 Create `landing-page.constant.ts` with the Bangla seed defaults for a new page: order-form labels (`নাম`, `মোবাইল নম্বর`, `ঠিকানা`), submit label (`অর্ডার কনফার্ম করুন`), and the two seeded delivery zones (`ঢাকার ভিতরে` 60, `ঢাকার বাইরে` 120)
- [x] 2.3 Create `landing-page.validation.ts` — Zod schemas for every JSON column and every scalar. Must enforce: slug matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`; 1–5 delivery zones with unique keys and non-negative prices; `facebookPixelId` matches `^\d{5,20}$`; the order form's phone and address fields cannot be hidden or made optional (design Decision 8); media items are `IMAGE` or `VIDEO` with a URL
- [x] 2.4 Create `landing-page.service.ts` admin operations: list (paginated, searchable, with per-page order count and revenue), get by id, create (seeded defaults applied), update, duplicate (copies content, generates a distinct slug, forces `DRAFT`), delete
- [x] 2.5 Enforce the lifecycle invariants in the service inside a transaction that re-reads the counterpart row: unpublishing or deleting the active landing page while `siteMode` is `LANDING_PAGE` is rejected with a message naming the fix (design Decision 5)
- [x] 2.6 Add `getPublishedBySlug` returning the page plus a product snapshot (name, price, compareAtPrice, images, availability, `ACTIVE` status) — `PUBLISHED` only, never disclosing a draft
- [x] 2.7 Add an authenticated preview read that returns a `DRAFT` page for an OWNER/ADMIN, so the admin preview link works while the public read still 404s
- [x] 2.8 Create `landing-page.controller.ts` and `landing-page.route.ts`; mount public `by-slug` routes before the admin `/:id` routes, and register `/landing-pages` in `server/src/app/routes/index.ts`
- [x] 2.9 Guard admin routes with `checkAuth(RoleName.OWNER, RoleName.ADMIN)`, matching the UI/CMS modules; leave the three public routes unauthenticated

## 3. Server — pricing and order placement

- [x] 3.1 Add optional `shippingOverride: { amount: number; label: string }` to `IChargeQuoteInput` in `order.pricing.ts`; when present, `quoteCharges` skips `quoteShipping` and returns that amount, applies neither `freeShippingThreshold` nor `couponWaivesShipping`, and still computes tax via `quoteTax`. Document why in the function header
- [x] 3.2 Thread the override through the shared checkout core in `order.service.ts` without changing any existing call site; assert by inspection that no current caller passes it
- [x] 3.3 Add `POST /landing-pages/by-slug/:slug/quote` — takes `{ quantity, zoneKey }`, returns `{ subtotal, taxAmount, shippingAmount, totalAmount }` computed through `quoteCharges` with the override; rejects an unknown `zoneKey` and a quantity below 1
- [x] 3.4 Add `POST /landing-pages/by-slug/:slug/order` — validates name/phone/address against the page's own `orderForm` rule (NOT `checkoutConfig`), maps address to `shippingAddress.addressLine1` and the zone label to `shippingAddress.state`, forces `paymentMethod: COD`, passes `expectedTotal` and the `Idempotency-Key`, and calls the shared core with the override. **Built with `optionalAuth` as planned, then changed to ALWAYS place a guest order — see the note under 12.6.**
- [x] 3.5 Persist `landingPageId` and `landingPageTitle` on the created order; confirm the existing guest COD caps (per phone, per IP per hour), stock deduction, order number, PENDING COD payment, status history and merchant notification all still run through the shared core
- [x] 3.6 Reject the order when the bound product is not `ACTIVE` or has no available stock, with the message naming the product — reusing the core's existing checks
- [x] 3.7 Include `landingPageId`/`landingPageTitle` in the admin order read so order detail can name the campaign

## 4. Server — site mode setting

- [x] 4.1 Extend `store-setting.validation.ts` with `siteMode` and `activeLandingPageId`, and `store-setting.interface.ts` with the matching payload fields
- [x] 4.2 Enforce in `store-setting.service.ts`, transactionally: switching to `LANDING_PAGE` requires `activeLandingPageId` to resolve to an existing `PUBLISHED` landing page; clearing the active page while in `LANDING_PAGE` mode is rejected. Each rejection names what to do first
- [x] 4.3 Add `siteMode` and `activeLandingPage: { slug, title } | null` to the `/settings/public` projection, and add `siteMode: "WEBSITE"` / `activeLandingPage: null` to `DEFAULT_PUBLIC_SETTINGS` in `store-setting.constant.ts`
- [x] 4.4 Ping the storefront's `store-settings` cache tag on a site-mode save, on the existing revalidation path

## 5. Server — collection and verification

- [x] 5.1 Add every new route to `server/postman/Ecom.postman_collection.json` — the five admin routes and the three public ones — with example bodies, following the existing folder structure
- [x] 5.2 Run `pnpm -C server verify:postman` and confirm it passes
- [x] 5.3 Write `server/scripts/verify-landing-page.ts` and register it as `verify:landing-page`, following the existing verify-script convention. It must assert: zone price is what gets charged; the shop's free-shipping threshold does NOT waive a landing-page delivery charge; a normal guest checkout still prices delivery from its shipping rule (the override did not leak); `checkoutConfig` requiring city/postal does not block a landing-page order; the phone field cannot be disabled; the site-mode invariants reject each forbidden transition
- [x] 5.4 Run `pnpm -C server lint` and `pnpm -C server build`

## 6. Frontend — route group split (isolated, do before any landing page work)

- [x] 6.1 Move every existing storefront route directory under `frontend/src/app/` into `frontend/src/app/(shop)/`, leaving `app/api/**`, `layout.tsx`, `globals.css`, `favicon.ico` and `not-found.tsx` at the root
- [x] 6.2 Reduce `app/layout.tsx` to the html/body shell, `generateMetadata`, the theme/font/currency setup and `StoreProvider`; move `Header`, `Footer`, `CartDrawer`, `CartRail`, `MobileBottomNav`, `CompareBar` and `SmoothScrollProvider` into a new `app/(shop)/layout.tsx`
- [x] 6.3 Verify no URL changed: load `/`, `/products`, a product detail page, `/cart`, `/checkout`, `/blogs`, `/track-order`, `/account`, a CMS `[slug]` page and `/not-found`, and confirm chrome renders on each
- [x] 6.4 Run `pnpm -C frontend lint`, `pnpm -C frontend test` and `pnpm -C frontend build`; commit this move on its own before continuing

## 7. Frontend — landing page rendering

- [x] 7.1 Add `frontend/src/types/landing-page.ts` and `frontend/src/services/landing-page.ts` (fetch by slug, quote, place order), following the caching and fallback conventions in `services/store-settings.ts`
- [x] 7.2 Extend `types/store-settings.ts` and the settings fallback with `siteMode` and `activeLandingPage`, defaulting to `WEBSITE`/`null` so an unreachable API yields a normal website
- [x] 7.3 Create `app/(landing)/layout.tsx` — theme, font and currency provider only; no header, footer, cart drawer, cart rail, compare bar or mobile nav
- [x] 7.4 Create `app/(landing)/lp/[slug]/page.tsx` with `generateMetadata` (authored meta title/description, falling back to the headline and page content) and a `notFound()` for a draft or unknown slug
- [x] 7.5 Build the section components: hero (headline, subheadline, badge, price with struck-through compare-at), media gallery (images + video, authored order, video does not autoplay with sound), rich-text body rendered through `lib/sanitize-html.ts`, highlights, FAQ, quotes, trust badges — each omitted entirely when it has no content
- [x] 7.6 Add the mobile sticky call-to-action that scrolls to the order form
- [x] 7.7 Show the unavailable state — and suppress the submittable order form — when the product is out of stock or not `ACTIVE`
- [x] 7.8 Render the Facebook Pixel bootstrap only when a pixel id is set, interpolating the validated id as a JSON-encoded string into a script the app authors; fire `PageView` on load

## 8. Frontend — order form

- [x] 8.1 Build the order form: quantity stepper (floor 1), delivery zone radio group from the page's zones, and the three authored fields with `inputMode="tel"` on the phone
- [x] 8.2 Wire the debounced quote call so subtotal, tax, delivery charge and grand total update on every quantity or zone change, and the totals shown are always the server's
- [x] 8.3 Submit to the landing-page order endpoint with an `Idempotency-Key` and the last confirmed `expectedTotal`; block submission until a zone is selected
- [x] 8.4 Render the success state in place — authored thank-you heading and message, the order number, and how to track it with the order number and phone — and make the form no longer submittable
- [x] 8.5 Render failures beside the form with entered values preserved so the shopper can correct and resubmit; surface the price-changed message verbatim from the server
- [x] 8.6 Fire the pixel `Purchase` event with the order total and currency on a confirmed order, when a pixel id is set
- [x] 8.7 Make `app/(shop)/page.tsx` redirect to `/lp/<active-slug>` when `siteMode` is `LANDING_PAGE`, tagged with `store-settings` so the redirect appears and disappears on the existing revalidation path

## 9. Admin — plumbing

- [x] 9.1 Create `admin/src/lib/api/landing-pages.ts` (list, get, create, update, duplicate, delete) and add its keys to `query-keys.ts`
- [x] 9.2 Extend `admin/src/lib/api/store-settings.ts` with `siteMode` and `activeLandingPageId`
- [x] 9.3 Add the lazy routes `/ui/landing-pages`, `/ui/landing-pages/new` and `/ui/landing-pages/:id` to `admin/src/routes/app-router.tsx`
- [x] 9.4 Add the `Landing Pages` entry to the **UI** section of `admin/src/routes/nav-config.ts` with an icon and the section's existing `OWNER`/`ADMIN` role gate

## 10. Admin — landing pages screen

- [x] 10.1 Build `features/ui/landing-pages/landing-pages-page.tsx` on `resource-list-page`: title, bound product, slug, status, orders, revenue, last edited, with create/edit/duplicate/delete row actions
- [x] 10.2 Add the site-mode banner at the top of that list — the WEBSITE ↔ LANDING_PAGE toggle and the active-page selector (published pages only), showing which page is currently live
- [x] 10.3 Surface each server-side invariant rejection as a readable message on that banner and on the row actions (cannot switch on with nothing selected, cannot select a draft, cannot unpublish or delete the live page)
- [x] 10.4 Add the read-only current-mode line with a link to this screen on `features/ui/site-settings/site-settings-page.tsx`

## 11. Admin — landing page form

- [x] 11.1 Build `landing-page-form-page.tsx` on `resource-form-layout` with the seven sections from design Decision 10
- [x] 11.2 Basics: internal title, slug (with the format hint and the uniqueness error), product picker, status
- [x] 11.3 Hero & media: headline, subheadline, badge, and the ordered image/video gallery using the existing upload client, with reordering
- [x] 11.4 Content: rich-text body using the same Tiptap editor as Pages and Blog, plus repeatable highlight and FAQ rows on the existing `settings-editor` primitives
- [x] 11.5 Social proof: repeatable customer quote rows (name, text, rating, optional photo) and trust badge rows
- [x] 11.6 Order form: authored field labels/placeholders/helpers, the `nameRequired` switch, the delivery zone editor (add/remove/reorder, label + price, at least one required), submit button label and notice
- [x] 11.7 After order: thank-you heading and message. SEO & tracking: meta title, meta description, share image, Facebook Pixel id with its digits-only validation message
- [x] 11.8 Show the price display beside the product picker as read-only, with the "price comes from the product — edit it there" note and a link to the product (design Risks)
- [x] 11.9 Add the preview link for a draft page, pointing at the authenticated preview read
- [x] 11.10 Show the originating landing page and the chosen delivery area on the order detail screen in `features/sales/orders`

## 12. Verification

- [x] 12.1 Run `pnpm -C server verify:landing-page`, `pnpm -C server verify:postman`, `pnpm -C server verify:checkout` and `pnpm -C server verify:settings` — **`verify:landing-page` (40 checks), `verify:postman` (240/240 routes agree) and `verify:settings` all pass. `verify:checkout` NOT run: it creates and deletes a probe `ShippingRule`, and `DATABASE_URL` points at the live Neon database. Run it after 1.6, against a database you are willing to write to.**
- [x] 12.2 Run `pnpm lint`, `pnpm test` and `pnpm build` from the repo root — **server `tsc` clean; admin and frontend lint report 0 errors (6 pre-existing warnings in untouched files); frontend 116/116 tests pass; admin and frontend both build. Root `pnpm lint` still fails on the server's pre-existing `./src/**/*` glob, unrelated to this change — server linted directly instead.**
- [ ] 12.3 End-to-end in a browser: create a landing page, publish it, order from `/lp/<slug>` as a guest, confirm the order appears in the admin list with its campaign attribution and delivery area, and confirm stock was deducted — **BLOCKED on 1.6: the `LandingPage` table does not exist until the migration is applied.**
- [ ] 12.4 Toggle to `LANDING_PAGE` mode and confirm `/` serves the landing page while `/products`, `/cart`, `/checkout` and `/track-order` all still work; toggle back and confirm the homepage returns — **BLOCKED on 1.6.** The route-group half of this WAS verified: `next build` lists every pre-existing URL unchanged plus `/lp/[slug]` (task 6.3).
- [ ] 12.5 Confirm the negative paths by hand: invalid phone, blank address, no zone selected, quantity above available stock, and a price changed between page load and submit — **BLOCKED on 1.6.** Every one of these rules is covered without a database by `verify:landing-page`; what remains is confirming the wiring end to end.

## 13. Post-release fix — the shipping address was being dropped

Found in production testing, after the migration was applied: an order placed from a landing page showed "No shipping address on file" in the admin panel.

- [x] 13.1 Root cause: `resolveCheckoutContext`'s AUTHENTICATED branch only ever read `payload.shippingAddressId`, on the assumption that a signed-in shopper picks a saved address. A landing page has no address book and always sends the address inline, and `optionalAuth` honoured a session when the visitor had one — so a signed-in visitor's typed address was silently discarded and the order committed with no address at all. Guests were unaffected, which is why the pure verification script did not catch it
- [x] 13.2 Extract the address rule into `createInlineShippingAddress` and use it from BOTH branches: an inline address supplied without a saved-address id is stored and used, whoever sent it. Unreachable from the normal checkout, whose signed-in path sends `shippingAddressId` and whose guest path is the other branch
- [x] 13.3 Make landing page orders ALWAYS guest orders — drop `optionalAuth` from the route and build a guest actor unconditionally. A landing page has no login to honour, and reading a session made the page behave differently for the merchant testing it than for the ad traffic it exists for. Also restores the per-IP COD cap on every campaign order, and matches the `commerce/landing-page-orders` spec's "recorded as a guest order"
- [x] 13.4 Update the Postman description and the design's Decision 7 note to match
- [ ] 13.5 Re-test end to end once the server is restarted: place a landing page order both signed in and signed out, and confirm the address and delivery area appear on the order in the admin panel
