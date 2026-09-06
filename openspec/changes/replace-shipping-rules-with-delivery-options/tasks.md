## 1. Settings shape — the new home for delivery

- [x] 1.1 Extend `checkoutConfigSchema` in `server/src/app/module/store-setting/store-setting.validation.ts` with `delivery: { offersPickup: boolean, options: [{ key, label, kind: "DELIVERY" | "PICKUP", price, days }] }`; `key` a slug, `label` non-empty and bounded, `price` a non-negative money value, `days` a non-negative integer
- [x] 1.2 Add a `superRefine` to that schema: reject a duplicate `label`, reject a duplicate `key`, and reject `offersPickup: true` when no option has `kind: "PICKUP"` — each with the message the spec's scenario names. The empty-list rejection belongs on a separate `checkoutConfigUpdateSchema` used by the PATCH, NOT here: this schema also parses stored rows, and a store that has never configured delivery legitimately has an empty list (see 1.3). Both halves of the spec's requirement are still met — a merchant cannot save an empty list, and checkout refuses to price one
- [x] 1.3 Add `delivery` to `DEFAULT_CHECKOUT_CONFIG` in `store-setting.constant.ts` with `offersPickup: false` and an empty option list, and note in the comment that an empty list is what makes a fresh store refuse checkout until delivery is configured
- [x] 1.4 `delivery` did NOT reach the public projection — `merge` swaps the whole value, so a row stored before this change is served without the key, and `getCheckoutConfig`'s parse would fail and discard the merchant's entire config for the defaults. Added `withDeliveryDefault` in `store-setting.service.ts`, applied on both the public projection and the checkout-config read, filling in only the absent key
- [x] 1.5 Extend `scripts/verify-site-settings.ts` with cases for each rule in 1.2: duplicate label and key rejected, empty list accepted stored but rejected on save, `offersPickup` with no pickup option rejected, a valid two-area list accepted, and the pre-change stored shape
- [x] 1.6 Mirror the type in `admin/src/lib/api/store-settings.ts` and `frontend/src/types/store-settings.ts` — plus the storefront's `FALLBACK_SETTINGS` and its per-block backfill in `services/store-settings.ts`, which would otherwise leave `delivery` undefined when the settings API is unreachable

## 2. Order records what was chosen

- [x] 2.1 Add a `DeliveryMethod` enum (`DELIVERY`, `PICKUP`) to `server/prisma/schema/enums.prisma`
- [x] 2.2 Add nullable `deliveryMethod`, `deliveryOptionKey` and `deliveryOptionLabel` to `Order` in `order.prisma`, with a comment explaining the key/label split (grouping across a rename versus what the shopper agreed to) and why all three are nullable — `npx prisma validate` passes
- [x] 2.3 Generate the migration; it must add only — no drops in this step

## 3. Pricing and order acceptance

- [x] 3.1 Delete `matchPlace` from `server/src/app/module/order/order.pricing.ts` and every import of it
- [x] 3.2 Replace `quoteShipping(lines, destination)` with `quoteDelivery(optionKey)`: resolve the option from `checkoutConfig.delivery.options`, return its price, days, method and label. Delivery is charged **once**; the per-rule grouping, the summing, `IShippingQuote`, `IDestination` and `IPricingLine.shippingRuleId` all go with it
- [x] 3.3 Throw a configuration error when the option list is empty, worded as a store setup problem, not as a shopper input problem
- [x] 3.4 Throw when the submitted key matches no option, with the "choose again" wording from the spec
- [x] 3.5 Throw when the submitted option is a pickup point while `offersPickup` is false
- [x] 3.6 Update `order.validation.ts` and `order.interface.ts`: the quote and place-order payloads carry the selected option key; the destination fields are gone. The key is required on the quote schema and optional on the order schema — a landing-page order legitimately has none, so the service enforces it once where it can tell the two paths apart. `deliveryMethod` is no longer a client-supplied field at all: it is a property of the chosen option, so a client cannot assert collection against a delivery price
- [x] 3.7 In `order.checkout-fields.ts`, treat address fields as not required when the chosen option is a pickup point, leaving name and phone required; keep the existing behaviour untouched for delivery
- [x] 3.8 Persist `deliveryMethod`, `deliveryOptionKey` and `deliveryOptionLabel` in `order.service.ts` when the order is created, capturing the label at that moment — all three read off the resolved option, never the request body
- [x] 3.9 `order.service.ts` never wrote city into `state` — the STOREFRONT does (`state: collected("city")`), so the fix lands in 7.3. Server-side, the obsolete `order.prisma` comment describing `state` as the pricing input has been corrected
- [x] 3.10 Landing-page orders confirmed untouched: `landing-page.service.ts` still passes `shippingOverride` and no option key, so `quoteDelivery` is never consulted and the three new order columns stay null

## 4. Backfill

- [x] 4.1 Write `server/scripts/backfill-delivery-options.ts`: read every `ShippingPlace`, dedupe by name, map `offersPickup` places to `PICKUP` options priced at `pickupPrice` and the rest to `DELIVERY` options priced at `price`, carry `deliveryDays`, generate a slug key per option, and write the result into `checkoutConfig.delivery.options`. Registered as `npm run backfill:delivery-options`; the derived config is re-parsed through `checkoutConfigSchema` before writing, since this is the one write path into `checkoutConfig` that bypasses the settings PATCH
- [x] 4.2 Make it idempotent and non-destructive: re-running must not duplicate options, and it must refuse to overwrite a `delivery.options` list that a merchant has already edited. One check does both — a non-empty list is left alone, because a merchant's edits and a previous run are indistinguishable
- [x] 4.3 Set `offersPickup` to true only when at least one migrated option is a pickup point
- [x] 4.4 Report what it wrote, and name any place it dropped as a duplicate, so a merchant can check nothing was lost silently
- [x] 4.5 Run it and compare the resulting list in Checkout Settings against the existing shipping rules. Migrated the single place "Outside Dhaka" (৳120, 0 days) from rule "Default 2" to one DELIVERY option `outside-dhaka` with pickup off, matching the source exactly; a second run confirmed it changes nothing. The store had never saved checkout settings, so the defaults were written alongside — a NULL config is an unconfigured store, not a malformed one, and is resolved the same way every reader already resolves it

## 5. Admin — Checkout Settings owns delivery

- [x] 5.1 Add a "Delivery" section to `admin/src/features/ui/checkout-settings/checkout-settings-page.tsx`: a reorderable list of options, each with label, price, days and a Delivery/Pickup point choice, plus add and remove. Built on the shared `EditorSection`/`EditorRow`/`moveItem` the other settings editors already use, so reordering and removal behave identically to Header Links and Footer Links
- [x] 5.2 Add the "Offer collection in person" checkbox, and disable or warn on it when no option is marked as a pickup point, matching the server rule from 1.2 so the form says no before the API does. Also handled the reverse direction the rule implies: removing the last pickup point, or retyping it as a delivery area, turns collection off with it rather than leaving a saved state that can no longer be saved
- [x] 5.3 Generate the `key` for a newly added option in the client and never rewrite it on rename. Positional (`option-N`), not slugified from the label — the label is empty at the moment a row is added, and the key only has to be unique and stable, never descriptive
- [x] 5.4 Mirror the duplicate-label and empty-list checks in the form so the message lands beside the offending row. Save is blocked while any row is in error, so the 400 is never reached
- [x] 5.5 Update `admin/src/lib/api/store-settings.ts` for the new payload shape. The types were already mirrored by 1.6, but `DEFAULT_CHECKOUT_CONFIG` was missing the `delivery` key it declares as required — a real type error that `tsc -p tsconfig.app.json` surfaces and a bare `tsc --noEmit` does not, since this project builds through references

## 6. Admin — remove the old surface

- [x] 6.1 Delete `admin/src/features/catalog/shipping-rules/` (page, form page, labels)
- [x] 6.2 Delete `admin/src/lib/api/shipping-rules.ts` and its entries in `lib/api/query-keys.ts`
- [x] 6.3 Remove the shipping-rules route from `routes/app-router.tsx` and the nav entry from `routes/nav-config.ts` — plus the `Route` icon import the nav entry was the only user of
- [x] 6.4 Remove the shipping-rule picker from `features/catalog/products/product-form-page.tsx` and `shippingRuleId` from `lib/api/products.ts`. The picker was `required: true`, so this also drops the rule that a product could not be saved without a delivery policy — which is the intended consequence, not a side effect: delivery is store-wide now and is not a property of a product
- [x] 6.5 `grep -rn "shipping-rule\|shippingRule" admin/src` must return zero matches — passes. The last match was a comment in `features/ui/banners/banner-labels.ts` citing the deleted `shipping-rule-labels.ts` as an example of the same file-splitting pattern; repointed at `bundle-deal-labels.ts`, which still exists

## 7. Storefront checkout

- [x] 7.1 Add the delivery chooser to `frontend/src/components/checkout/CheckoutForm.tsx`: when `offersPickup` is on, a Delivery/Collection step first, then the matching list; when off, the delivery areas alone with no first step. The first step is also skipped when collection is on but no pickup point is configured — there is no choice to present. A single option in the shown list is auto-selected, since ticking the only box is a step and not a choice
- [x] 7.2 Send the selected option key on both the quote request and the order payload, so the quoted amount and the charged amount come from the same choice. The key is also part of the idempotency fingerprint: changing the option makes it a different order, which must not resolve to the one already placed at the old price
- [x] 7.3 Stop sending the City field as `state` for pricing — `state` is gone from the quote request and the guest order payload entirely, along with the whole address from the quote, since nothing prices from an address any more
- [x] 7.4 Hide the delivery address fields when a pickup point is selected, and restore them with their required-field rules when the shopper switches back. `validateGuest` drops the address rules on the same condition, matching the server's `collectMissingCheckoutFields`, so the form and the API agree on what a collection order needs
- [x] 7.5 Show the option's price and estimated days beside each choice, and name the chosen option on the summary's delivery line rather than a generic "Delivery"
- [x] 7.6 Handle the "option no longer exists" refusal by re-reading settings and asking the shopper to choose again. Settings arrive as a server-rendered prop, so re-reading is `router.refresh()`; it fires once per offending key, because the refusal survives until the shopper picks again and refreshing on every render of it would loop
- [x] 7.7 Update `frontend/src/types/order.ts` for the new payload and the order's delivery fields

## 8. Order views

- [x] 8.1 Show the chosen option's label on the admin order detail page, and mark a collection order as a collection so it is not dispatched to a courier. The label replaces the generic "Shipping" totals row, and a collection order gets a "Collection — do not dispatch" card plus an address card retitled "Contact details" whose empty state reads as expected rather than as missing data. `ORDER_DETAIL_INCLUDE` needed no change — it is an `include`, so the three new scalars already come back; its comment claiming the delivery choice lives on `shippingAddress.state` was stale and is corrected to say that is the landing-page path only
- [x] 8.2 Show the same on the storefront's order confirmation and order history — one edit to `OrderSummaryCard`, which all three views (signed-in confirmation, guest confirmation, guest tracking) already share, so they cannot drift. A collection order shows "Collecting from" in place of "Delivering to", since it may carry no address at all

## 9. API docs and verification

- [x] 9.1 Remove the `/shipping-rules` folder from all three Postman collections (`server/`, `admin/`, `frontend/`) — done together with 11.2, because `verify-postman-routes.ts` compares the collection against the LIVE route files: removing the folder while the routes still existed would have failed 9.3, and vice versa. The two are one atomic step
- [x] 9.2 Update the settings PATCH example body with `checkoutConfig.delivery`, and the checkout quote and place-order bodies with the selected option key. Also removed `shippingRuleId` from the product example bodies, dropped the `shippingRule*` collection variables, rewrote the quote/place-order descriptions for the new contract, and replaced the guest quote's inline `country`/`state` body — that shape no longer exists
- [x] 9.3 `npm run verify:postman` passes — 234 routes, down from 240 by exactly the six deleted shipping-rule endpoints
- [x] 9.4 Update `scripts/verify-checkout-totals.ts` for the new pricing path — delivery charged once, pickup priced from the option, unknown key refused. Rewritten rather than adapted: every assertion it held (specificity, unmatched-destination refusal, summing per rule) describes behaviour this change deletes. The new one swaps in a probe option list and restores the merchant's real config in a `finally`, verified byte-identical afterwards
- [x] 9.5 Update `verify-catalog-change.ts`, `verify-currency-and-content.ts` and `verify-landing-page.ts` for the removed product field and the unchanged landing-page path. `verify-landing-page.ts` had two assertions reading fields that no longer exist (`shipping.matches`, `pickupAmount`) — a genuine break that `tsc` could not catch, since `tsconfig.json` includes only `src`. Also retired `scripts/backfill-delivery-options.ts` and its npm script: its source tables are gone, so it can no longer run and would crash on a store with an empty list
- [x] 9.6 `npm run verify:settings`, `verify:checkout`, `verify:catalog` and `verify:landing-page` all pass

## 10. End-to-end check

- [ ] 10.1 With pickup off: two delivery areas offered, no collection step, correct amount quoted and charged
- [ ] 10.2 With pickup on: the two-step chooser appears, a pickup point can be selected, no address is asked for, and the order is accepted
- [ ] 10.3 Switching from pickup back to a delivery area re-asks for the address and re-applies required fields
- [ ] 10.4 An order placed under an option that is then renamed still shows the old label; one placed under an option that is then deleted still shows what was charged
- [ ] 10.5 A store with an empty option list refuses checkout with the configuration message
- [ ] 10.6 A landing-page order still prices from its own zones and is unaffected

## 11. Drop the old model

- [x] 11.1 After a soak, remove `ShippingRule` and `ShippingPlace` from `server/prisma/schema/ShippingRule.prisma` and `shippingRuleId` from `product.prisma`; generate the drop migration. **The soak was waived by explicit user decision** — the tradeoff was stated and accepted: from this migration on, recovering the old rules means restoring from backup rather than reverting the release. Constraint names and row counts were confirmed against the live database first (1 rule, 1 place, 2 linked products — all already carried across by the backfill)
- [x] 11.2 Delete `server/src/app/module/shipping-rule/` and its mount in `app/routes/index.ts`
- [x] 11.3 Remove `shippingRuleId` from `product.interface.ts`, `product.validation.ts` and `product.service.ts` — plus the `shippingRule` relation in `PRODUCT_DETAIL_INCLUDE` and the product select in `landing-page.service.ts`
- [x] 11.4 `grep -rn "shippingRule\|ShippingPlace\|matchPlace" server/src frontend/src admin/src` (excluding generated Prisma output) must return zero matches — passes
