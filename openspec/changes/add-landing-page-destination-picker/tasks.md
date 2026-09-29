## 1. Remove the per-campaign price list

- [x] 1.1 Drop `deliveryZones` from `server/prisma/schema/LandingPage.prisma`, and remove the model comment describing it. Verify `npx prisma validate`.
- [x] 1.2 Generate the migration and **write into its comment that the authored zone prices are NOT migrated into the shop's options, and why** — a campaign charging a different rate has two rates and only the merchant knows which is correct (design.md Decision 2). Verify the comment is present.
- [x] 1.3 Delete the three trigram `DROP INDEX` lines and carry the NOTE block forward. Verify no executable `DROP INDEX` remains, then apply.
- [x] 1.4 Remove `deliveryZones` from `landing-page.validation.ts`, `landing-page.interface.ts`, `DEFAULT_DELIVERY_ZONES` in the constants, and both storefront and admin type copies. Verify all three workspaces typecheck.
- [x] 1.5 Delete `resolveDeliveryZone` from the landing service. Verify nothing references it.

## 2. Price campaign orders by the shop's options

- [x] 2.1 Change `quoteLandingPageOrder` to take `deliveryOptionKey` instead of `zoneKey`, and price through `quoteCharges` with the shop's `checkoutConfig` rather than through `shippingOverride`. Verify the quote matches what the shop's checkout quotes for the same option.
- [x] 2.2 Do the same in `placeLandingPageOrder`, dropping `shippingOverride` entirely on this path. Verify a campaign order is charged the option's stored price.
- [x] 2.3 Confirm the behaviour change this brings: campaign orders now receive the shop's free-shipping threshold and a coupon's shipping waiver, which they previously never did (design.md Decision 5). Verify by placing a campaign order above the threshold.
- [x] 2.4 Write the destination into `shippingAddress.state` where the zone label used to go, in the shape a shop order uses. Verify a campaign order and a shop order read identically.
- [x] 2.5 Refuse an option key the shop does not have, and refuse a client-supplied delivery amount. Verify both, and that no order is created by either.
- [x] 2.6 Update the landing order validation: `deliveryOptionKey` replaces `zoneKey`, and a destination is accepted. Verify a complete payload parses and the old shape is refused.

## 3. The storefront form

- [x] 3.1 Render `DestinationField` in `LandingOrderForm`, the same component the shop checkout and the saved-address form use. Verify it searches and selects.
- [x] 3.2 Derive the option with `resolveDeliveryOption` and state the charge. The shopper does not choose it while a destination resolves (design.md Decision 1). Verify the charge follows the destination.
- [x] 3.3 Fall back to the shop's delivery options on a refusal, with `refusalMessage` stating why — and only AFTER a destination has been given, never as the opening question. Verify each refusal reason renders its own message.
- [x] 3.4 Keep exactly one key in force — derived or chosen, never both — and quote and submit against it, following `optionKeyInForce` in `CheckoutForm`. Verify switching from an unserved district to a served one withdraws the cards.
- [x] 3.5 Remove the old zone radio cards and everything reading `page.deliveryZones`. Verify no reference remains.
- [x] 3.6 Confirm a campaign with no destination chosen states no delivery charge and shows no error. Verify on first load.

## 4. Admin

- [x] 4.1 Remove the delivery-zones editor from the landing page form and its schema fields. Verify the form saves without them.
- [x] 4.2 Put a line where it was saying delivery is configured in Checkout Setting, with a link — the merchant who went looking for the zones editor must find out where it went. Verify the link resolves.
- [x] 4.3 Update the landing-page form test's mocks and any fixture carrying `deliveryZones`. Verify the suite passes.

## 5. Verification

- [x] 5.1 Extend `verify-landing-page-shapes.ts`: `deliveryZones` must be ABSENT from all three copies, and its absence must be asserted rather than merely unmentioned. Verify it fails if the field is reintroduced.
- [x] 5.2 Add `npx tsx scripts/verify-landing-destination.ts` covering the resolution path end to end — a served district prices from the shop's option, an unserved one refuses, an unknown option key is refused, and a client-supplied amount is not honoured. Creates `__verify_*` rows, cleans up in a `finally`. Verify it passes.
- [x] 5.3 Assert the two paths agree: the same destination and product quote the same delivery charge through the shop checkout and through a campaign. Verify by script.
- [x] 5.4 Update `seed-bangla-landing-page.ts` — no `deliveryZones`, and the page reviewable with the destination picker. Verify the seeded page renders the picker and derives a charge.
- [x] 5.5 Run both test suites, every landing verify script, and all three typechecks. Verify no regression.
