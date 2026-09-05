## 1. Server — data model

- [x] 1.1 Add six columns to `server/prisma/schema/StoreSetting.prisma`: `footerLogoUrl`, `siteUrl`, `metaTitle`, `metaDescription` (nullable scalars), plus `checkoutConfig Json?` and `theme Json?`
- [x] 1.2 Extend the model's doc-comment to cover the two new Json columns, restating that their Zod schemas are the only gate on shape (matching how `mainNav` and friends are documented)
- [x] 1.3 Create and run the migration; confirm it is purely additive and nullable with no backfill step — defaults live in code and are merged on read

## 2. Server — validation

- [x] 2.1 Add `checkoutFieldSchema` (`{ show: boolean, required: boolean }`, `.strict()`) and `checkoutConfigSchema` with the six field keys `fullName`, `phone`, `addressLine1`, `addressLine2`, `city`, `postalCode` — keys chosen to match the order payload — plus `showCouponBox`, `showOrderNote`, `allowGuestCheckout`, `notice` (max 300)
- [x] 2.2 Add the two `superRefine` invariants: reject any field that is `{ show: false, required: true }`, and reject any config where `phone` is not `{ show: true, required: true }`; both errors must name the offending field
- [x] 2.3 Add `themeSchema`: six colour keys validated by a strict hex pattern that admits nothing beyond `#rgb`/`#rrggbb` (so a value cannot smuggle further declarations), `maxWidth` as one of the offered widths (1140 / 1280 / 1440 / 1600) or the full-width sentinel, and `font` as `{ family, url }` — this shipped as a free 960–2560 range and was closed to a fixed set once the hero was proportioned from it
- [x] 2.4 Write the Google Fonts embed parser: accept `@import url("…");`, `<link href="…" …>` and a bare URL; parse with `new URL()`; require `protocol === "https:"` and `hostname === "fonts.googleapis.com"` by exact equality (never a suffix check); extract the family as the text before the first `:` with `+` decoded to spaces
- [x] 2.5 Have the parser **rebuild** the stored URL from validated components (origin, path, re-serialised `family`, `display=swap`) rather than retaining any input substring, and return `{ family, url }`
- [x] 2.6 Cover the parser's rejections explicitly: a non-Google host, a lookalike host such as `fonts.googleapis.com.evil.test`, an `http:` URL, and text containing no recognisable stylesheet URL — each must be refused with a message and leave the stored font unchanged
- [x] 2.7 Extend `updateStoreSettingZodSchema` with the four new scalars (`siteUrl` as a validated absolute http/https URL) and the two new blocks, all `.optional()` so partial PATCHes stay non-clobbering

## 3. Server — defaults and public projection

- [x] 3.1 Add `DEFAULT_CHECKOUT_CONFIG` to `store-setting.constant.ts`, reproducing today's checkout exactly: name/phone/address/city shown+required, apartment and postal code shown+optional, note shown, guest checkout allowed, empty notice
- [x] 3.2 Add `DEFAULT_THEME` mirroring the current `globals.css` values — `#ffffff`, `#1a1a1a`, `#0f63b3`, `#133f9e`, `#f5b301`, `#e02020` — with `maxWidth: 1440` (the middle offered width; this shipped as 1384, the old `max-w-346`, which the closed set no longer offers) and the Outfit family and its current stylesheet URL
- [x] 3.3 Opt the six new fields into the `getPublicStoreSetting` **allow-list**, one explicit merged entry each; do not introduce any row spread
- [x] 3.4 Update `store-setting.interface.ts` for the new payload fields

## 4. Server — order enforcement

- [x] 4.1 Read the stored `checkoutConfig` in the guest branch of `resolveCheckoutContext`, falling back to `DEFAULT_CHECKOUT_CONFIG` when the column is null or fails to parse, so a settings problem degrades to today's behaviour rather than an unusable checkout
- [x] 4.2 Reject the order with `401` at the top of the guest branch when `allowGuestCheckout` is false — before the address is created and before guest limits are checked
- [x] 4.3 Replace the hardcoded `!payload.fullName || !payload.phone || !payload.shippingAddress` check at `order.service.ts:440` with a loop over `checkoutConfig.fields` that collects every required-but-absent field and throws one `400` naming them
- [x] 4.4 Keep an independent hardcoded phone check alongside the loop, so a database row edited outside the API cannot disable order lookup or the per-phone COD cap
- [x] 4.5 Pass `"Guest"` to `getOrCreateCustomerByPhone` when the name is legitimately absent, so no customer record is created nameless
- [x] 4.6 Verify end-to-end: an order missing a field the config marks optional is accepted; one missing a required field is rejected with that field named and no order row or stock reservation created; a guest order is refused with 401 while guest checkout is off

## 5. Frontend — theme, width and metadata

- [x] 5.1 Extend `src/types/store-settings.ts` with the identity scalars and the `checkoutConfig` and `theme` blocks
- [x] 5.2 Extend `FALLBACK_SETTINGS` in `src/services/store-settings.ts` with both new blocks, mirroring the server's defaults, and backfill them per-field the way the existing blocks are
- [x] 5.3 Apply the theme as an inline `style` attribute on `<html>` in `src/app/layout.tsx` — the six colour tokens, `--font-sans` and `--site-max-width` — re-validating each value against its pattern immediately before interpolation
- [x] 5.4 Render the merchant's font stylesheet `<link>` from the layout, keeping the existing fallback stack behind the configured family
- [x] 5.5 Replace the hardcoded `metadata` export with `generateMetadata()` reading meta title, description and `metaBase` from settings; fall back to the site name when no meta title is stored, and leave page-level metadata taking precedence
- [x] 5.6 Add `.site-container` to `globals.css` (`max-width: var(--site-max-width, 90rem); margin-inline: auto` — shipped as `86.5rem`, moved with the default) and note in the existing `:root` comment that those values are now the fallback for an unconfigured store
- [x] 5.7 Replace `max-w-346` with `site-container` across all 23 call sites in 16 files, dropping the now-redundant `mx-auto`; **`grep -r "max-w-346" frontend/src` must return zero matches**
- [x] 5.8 Check both width modes in a browser: a narrower configured width narrows every surface consistently, full width keeps `container-px`'s side padding, and a viewport narrower than the configured width produces no horizontal scroll

## 6. Frontend — checkout

- [x] 6.1 Pass settings into `src/app/checkout/page.tsx` and `src/app/cart/page.tsx` from their existing server-side reads
- [x] 6.2 Drive the guest field block in `CheckoutForm.tsx` from `checkoutConfig.fields`: render only shown fields, mark optional ones in their label, and gate `validateGuest()` on the config rather than its current hardcoded list
- [x] 6.3 Send `undefined` rather than empty strings for hidden fields, so the payload matches what the server now treats as absent
- [x] 6.4 Redirect a signed-out shopper away from checkout to sign-in when guest checkout is off, preserving the cart and returning to checkout after login
- [x] 6.5 Render `CouponForm` on the checkout page and gate both it and the cart page's instance on `showCouponBox`; confirm an already-applied discount stays honoured and visible when the box is switched off
- [x] 6.6 Gate the order note section on `showOrderNote`
- [x] 6.7 Render `notice` directly above the Place Order button, and render no element at all when it is empty

## 7. Admin — API layer

- [x] 7.1 Extend `src/lib/api/store-settings.ts` with the new scalars and the `CheckoutConfig` and `Theme` types, mirroring the backend schemas and their limits
- [x] 7.2 Add the new fields to `StoreSettingsInput`, keeping every key optional so the new pages stay non-clobbering like the existing three editors
- [x] 7.3 Add an image upload hook to `src/lib/api/uploads.ts` posting to `POST /uploads/image`, alongside the existing video upload

## 8. Admin — Checkout Setting page

- [x] 8.1 Add **Checkout Setting** under the UI section in `src/routes/nav-config.ts` and route `/ui/checkout-settings` in `app-router.tsx`, matching the section's existing `OWNER`/`ADMIN` restriction
- [x] 8.2 Build the field table with Show-on-checkout and Required columns for the six fields, following the mockup's layout
- [x] 8.3 Render the mobile number row's two checkboxes checked and locked, with a note explaining that order tracking and the COD limit depend on it
- [x] 8.4 Clear a field's Required checkbox in the same interaction that turns off its Show, so the contradictory state the server rejects cannot be submitted
- [x] 8.5 Show an inline warning on the City row when its Required is turned off, naming the drop to country-level then catch-all shipping and the risk of orders being refused where neither exists
- [x] 8.6 Add the three switches (coupon box, order note, guest checkout) and the notice text field, then wire save through the shared editor actions, sending only this page's keys
- [x] 8.7 Reuse the section's existing unsaved-changes guard so navigating away mid-edit prompts

## 9. Admin — Site Setting page

- [x] 9.1 Add **Site Setting** under the UI section and route `/ui/site-settings`
- [x] 9.2 Add header and footer logo upload fields using `SingleImageField` and the upload hook, each showing the currently stored image and supporting removal
- [x] 9.3 Add the identity fields: site name, accent, site URL, meta title, meta description, copyright text
- [x] 9.4 Add the font field as a paste target accepting any of the three Google Fonts embed forms, showing the parsed family name back to the merchant on success and the server's message on rejection
- [x] 9.5 Add colour inputs for the six tokens with live swatches, plus an advisory contrast ratio for the background/foreground pair that warns without blocking
- [x] 9.6 Add the content-width control as a picker over the offered widths plus a full-width option, stating the default and snapping a stored width that predates the set to the nearest option — this shipped as a free numeric field bounded 960–2560
- [x] 9.7 Note on the page that storefront changes appear within a few minutes, matching the settings cache window
- [x] 9.8 Remove the Branding block (`storeName`, `siteNameAccent`, `logoUrl`, `aboutText`, `copyrightText`) from `store-settings-page.tsx` and its form schema, leaving a line pointing at UI → Site Setting
- [x] 9.9 Confirm saving either page leaves the other's fields and all commerce configuration untouched

## 10. Postman and verification

- [x] 10.1 Update `server/postman/Ecom.postman_collection.json` for the settings payload changes, including example bodies for the two new blocks
- [x] 10.2 Copy the collection byte-identically to `admin/postman/` and `frontend/postman/`, then confirm all three match
- [x] 10.3 Run `pnpm -C server verify:postman` and confirm it passes
- [x] 10.4 Run lint, tests and build across all three apps (`pnpm lint`, `pnpm test`, `pnpm build` from the root)
- [x] 10.5 Walk the storefront once with a fully configured store and once with an empty settings table, confirming the unconfigured case is visually and behaviourally identical to today
