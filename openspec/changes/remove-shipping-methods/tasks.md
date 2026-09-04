## 1. Server — pricing

- [x] 1.1 In `src/app/module/order/order.pricing.ts`, drop the `fallbackFlatPrice` parameter from `quoteShipping` and replace the `ruleIds.length === 0` early return with an `AppError(400)` naming the products that cannot be delivered, following the message style of the existing unmatched-place throw.
- [x] 1.2 Remove `fallbackFlatShippingPrice` from `IChargeQuoteInput` and from the `quoteShipping` call inside `quoteCharges`.
- [x] 1.3 Update the `quoteShipping` doc comment — it currently describes the `ShippingMethod` fallback as the behaviour, which is the thing being removed.

## 2. Server — order and shipment modules

- [x] 2.1 In `order.service.ts`, delete the `shippingMethod` lookup and its `isActive` guard from the checkout path (~L554-560) and the parallel lookup in the quote path (~L879-882).
- [x] 2.2 In `order.service.ts`, remove `fallbackFlatShippingPrice` from both `quoteCharges` calls (~L663, ~L901).
- [x] 2.3 In `order.service.ts`, delete the conditional shipment creation at checkout (~L713-714) entirely — the shipment is opened by the admin at dispatch, not by checkout (see design.md).
- [x] 2.4 Remove `shipments: { include: { shippingMethod: true } }` from the order include (~L36); keep the shipments relation itself.
- [x] 2.5 Remove `shippingMethodId` from `order.validation.ts` (both schemas) and `order.interface.ts` (both payload types).
- [x] 2.6 Remove `shippingMethodId` from `shipment.validation.ts` (both schemas) and `shipment.interface.ts`, and drop the three `include: { shippingMethod: true }` clauses in `shipment.service.ts`.

## 3. Server — module and route removal

- [x] 3.1 Delete `src/app/module/shipping-method/` (interface, validation, service, controller, route).
- [x] 3.2 Remove the `ShippingMethodRoutes` import and the `router.use("/shipping-methods", …)` mount from `src/app/routes/index.ts`.
- [x] 3.3 Confirm the server builds with no remaining reference: `npx tsc --noEmit` clean, and a repo-wide search for `shippingMethod` under `server/src` returns nothing.

## 4. Server — schema and migration

- [x] 4.1 Delete `prisma/schema/ShippingMethod.prisma`.
- [x] 4.2 Remove the `shippingMethodId` field, the `shippingMethod` relation and the `@@index([shippingMethodId])` from `prisma/schema/Shipment.prisma`.
- [x] 4.3 Generate the migration and confirm it drops the `Shipment_shippingMethodId_idx` index, the `Shipment.shippingMethodId` column and the `ShippingMethod` table — and nothing else. Written as `20260904090000_remove_shipping_methods`. Two things had to be handled first, both pre-existing: (a) `_prisma_migrations` held a stale rolled-back row plus a stale checksum for `align_admin_catalog`, which made `migrate dev` demand a full database reset — repaired in place, bookkeeping only, backup kept; (b) the generated diff again carried the three spurious `DROP INDEX` statements for the raw-SQL `pg_trgm` indexes, removed as in the three preceding migrations.
- [x] 4.4 Run the migration against the development database and regenerate the Prisma client. Applied with `migrate deploy` (the environment is non-interactive, so `migrate dev` cannot answer its data-loss prompt); `migrate status` reports the schema up to date.

## 5. Admin

- [x] 5.1 Delete `src/features/sales/shipping-methods/` and `src/lib/api/shipping-methods.ts`.
- [x] 5.2 Remove the `shippingMethods` entry from `src/lib/api/query-keys.ts`.
- [x] 5.3 Remove the two lazy imports and three `/sales/shipping-methods` routes from `src/routes/app-router.tsx`.
- [x] 5.4 Remove the Sales → Shipping Methods item from `src/routes/nav-config.ts`. The now-unused `Truck` icon import went with it.
- [x] 5.5 In `src/lib/api/shipments.ts`, drop the `ShippingMethod` import and the `shippingMethodId`/`shippingMethod` fields from the shipment types.
- [x] 5.6 In `src/features/sales/orders/order-detail-page.tsx`, remove the `useShippingMethods` query, the `shippingMethodId` schema field and form default, the Method `<SelectItem>` list and the `Method` row — showing the shipment's `carrier` in its place. (A `Carrier` row already existed, so nothing was added.)
- [x] 5.7 Confirm the admin builds and that no `shipping-method` reference remains under `admin/src`.

## 6. Storefront

- [x] 6.1 Delete `src/services/shipping.ts` and the `ApiShippingMethod` / `ShippingMethod` types from `src/types/order.ts`, along with `shippingMethodId` on both order payload types.
- [x] 6.2 In `src/app/checkout/page.tsx`, stop calling `getShippingMethods()` and stop passing `shippingMethods` to the form.
- [x] 6.3 In `src/components/checkout/CheckoutForm.tsx`, remove the `shippingMethods` prop, the `shippingMethodId` state, its entry in `orderFingerprint`, its `canPlaceOrder` condition and its two places in the submit payloads. It was also dropped from the quote request.
- [x] 6.4 Replace the method radio group (~L606-630) with a read-only delivery summary rendering the quote's matched place name, price and delivery days. Leave the collect-in-person toggle and its `pickupAmount !== null` gate untouched. The section heading became "Delivery"; the empty state now prompts for an address rather than reporting no methods.
- [x] 6.5 Stop forwarding `shippingMethodId` in `src/app/api/orders/route.ts` and `src/app/api/orders/quote/route.ts`, and update both header comments that document the body shape. Both handlers proxy the body verbatim rather than naming fields, so only the comments needed changing.
- [x] 6.6 Confirm the storefront builds and that no `shippingMethod` reference remains under `frontend/src`.

## 7. Verification

- [x] 7.1 Quote a basket of the two existing products to a Bangladesh address and confirm the delivery amount is the matched place's ৳80 with 3 delivery days — unchanged from before the change. Also confirmed the two products sharing one rule are charged one delivery, not two.
- [x] 7.2 Place an order end to end without sending any delivery selection and confirm it commits at the same total, with a shipment row that carries no method. Verified through `OrderService.quoteCheckout` rather than a committed order: it is the same `quoteCharges` path `placeOrder` uses, and committing a real order would leave a permanent row and deduct stock in a catalogue of two products. A stale `shippingMethodId` was sent deliberately and had no effect, as the spec requires.
- [x] 7.3 Temporarily null a product's `shippingRuleId` and confirm a basket of only that product is refused with a 400 naming it, then restore the rule. Refusal read: `"Q10 HiFi Stereo Sports Noise Reduction Earbuds" cannot be delivered — no delivery option has been set up for it`. Rule restored and re-asserted.
- [x] 7.4 Confirm a basket mixing a rule-less product with a ruled one is accepted and charges only the matched rule.
- [x] 7.5 Confirm the admin's order detail page renders a shipment and its carrier with no Method control, and that `/sales/shipping-methods` is gone from the sidebar and 404s. Verified by a clean `vite build` carrying no `shipping-method` chunk (the `shipping-rule` ones remain), the nav entry removed, and the route now falling to the existing `path="*"` `NotFoundPage`.

## 8. Follow-ups surfaced during implementation

- [ ] 8.1 Re-create the ৳160 "Outside Dhaka" tier as a second place on the `Default 1` shipping rule in `/catalog/shipping-rules`. Merchant data entry, deliberately not done in code — and blocked in practice by 8.2.
- [ ] 8.2 Decide whether `ShippingPlace` should match on `city`. A Bangladeshi address puts "Dhaka" in `city`, but places match `country`/`state`, so the storefront works around it by sending a guest's city as `state`. An Inside/Outside Dhaka split cannot be authored honestly until this is settled. Its own change.
