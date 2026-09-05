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
- [ ] 2.3 Generate the migration; it must add only — no drops in this step

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

- [ ] 4.1 Write `server/scripts/backfill-delivery-options.ts`: read every `ShippingPlace`, dedupe by name, map `offersPickup` places to `PICKUP` options priced at `pickupPrice` and the rest to `DELIVERY` options priced at `price`, carry `deliveryDays`, generate a slug key per option, and write the result into `checkoutConfig.delivery.options`
- [ ] 4.2 Make it idempotent and non-destructive: re-running must not duplicate options, and it must refuse to overwrite a `delivery.options` list that a merchant has already edited
- [ ] 4.3 Set `offersPickup` to true only when at least one migrated option is a pickup point
- [ ] 4.4 Report what it wrote, and name any place it dropped as a duplicate, so a merchant can check nothing was lost silently
- [ ] 4.5 Run it and compare the resulting list in Checkout Settings against the existing shipping rules

## 5. Admin — Checkout Settings owns delivery

- [ ] 5.1 Add a "Delivery" section to `admin/src/features/ui/checkout-settings/checkout-settings-page.tsx`: a reorderable list of options, each with label, price, days and a Delivery/Pickup point choice, plus add and remove
- [ ] 5.2 Add the "Offer collection in person" checkbox, and disable or warn on it when no option is marked as a pickup point, matching the server rule from 1.2 so the form says no before the API does
- [ ] 5.3 Generate the `key` for a newly added option in the client and never rewrite it on rename
- [ ] 5.4 Mirror the duplicate-label and empty-list checks in the form so the message lands beside the offending row
- [ ] 5.5 Update `admin/src/lib/api/store-settings.ts` for the new payload shape

## 6. Admin — remove the old surface

- [ ] 6.1 Delete `admin/src/features/catalog/shipping-rules/` (page, form page, labels)
- [ ] 6.2 Delete `admin/src/lib/api/shipping-rules.ts` and its entries in `lib/api/query-keys.ts`
- [ ] 6.3 Remove the shipping-rules route from `routes/app-router.tsx` and the nav entry from `routes/nav-config.ts`
- [ ] 6.4 Remove the shipping-rule picker from `features/catalog/products/product-form-page.tsx` and `shippingRuleId` from `lib/api/products.ts`
- [ ] 6.5 `grep -rn "shipping-rule\|shippingRule" admin/src` must return zero matches

## 7. Storefront checkout

- [ ] 7.1 Add the delivery chooser to `frontend/src/components/checkout/CheckoutForm.tsx`: when `offersPickup` is on, a Delivery/Collection step first, then the matching list; when off, the delivery areas alone with no first step
- [ ] 7.2 Send the selected option key on both the quote request and the order payload, so the quoted amount and the charged amount come from the same choice
- [ ] 7.3 Stop sending the City field as `state` for pricing
- [ ] 7.4 Hide the delivery address fields when a pickup point is selected, and restore them with their required-field rules when the shopper switches back
- [ ] 7.5 Show the option's price and estimated days beside each choice
- [ ] 7.6 Handle the "option no longer exists" refusal by re-reading settings and asking the shopper to choose again
- [ ] 7.7 Update `frontend/src/types/order.ts` for the new payload and the order's delivery fields

## 8. Order views

- [ ] 8.1 Show the chosen option's label on the admin order detail page, and mark a collection order as a collection so it is not dispatched to a courier
- [ ] 8.2 Show the same on the storefront's order confirmation and order history

## 9. API docs and verification

- [ ] 9.1 Remove the `/shipping-rules` folder from all three Postman collections (`server/`, `admin/`, `frontend/`)
- [ ] 9.2 Update the settings PATCH example body with `checkoutConfig.delivery`, and the checkout quote and place-order bodies with the selected option key
- [ ] 9.3 `npm run verify:postman` passes
- [ ] 9.4 Update `scripts/verify-checkout-totals.ts` for the new pricing path — delivery charged once, pickup priced from the option, unknown key refused
- [ ] 9.5 Update `verify-catalog-change.ts`, `verify-currency-and-content.ts` and `verify-landing-page.ts` for the removed product field and the unchanged landing-page path
- [ ] 9.6 `npm run verify:settings`, `verify:checkout`, `verify:catalog` and `verify:landing-page` all pass

## 10. End-to-end check

- [ ] 10.1 With pickup off: two delivery areas offered, no collection step, correct amount quoted and charged
- [ ] 10.2 With pickup on: the two-step chooser appears, a pickup point can be selected, no address is asked for, and the order is accepted
- [ ] 10.3 Switching from pickup back to a delivery area re-asks for the address and re-applies required fields
- [ ] 10.4 An order placed under an option that is then renamed still shows the old label; one placed under an option that is then deleted still shows what was charged
- [ ] 10.5 A store with an empty option list refuses checkout with the configuration message
- [ ] 10.6 A landing-page order still prices from its own zones and is unaffected

## 11. Drop the old model

- [ ] 11.1 After a soak, remove `ShippingRule` and `ShippingPlace` from `server/prisma/schema/ShippingRule.prisma` and `shippingRuleId` from `product.prisma`; generate the drop migration
- [ ] 11.2 Delete `server/src/app/module/shipping-rule/` and its mount in `app/routes/index.ts`
- [ ] 11.3 Remove `shippingRuleId` from `product.interface.ts`, `product.validation.ts` and `product.service.ts`
- [ ] 11.4 `grep -rn "shippingRule\|ShippingPlace\|matchPlace" server/src frontend/src admin/src` (excluding generated Prisma output) must return zero matches
