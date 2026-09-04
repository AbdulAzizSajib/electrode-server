## Why

`ShippingRule` was introduced in `align-admin-catalog-with-reference` to replace `ShippingMethod`'s flat price, which charged the same to deliver across the city as across the country. The rules landed; the methods were never removed. The two now contradict each other on a live path.

`quoteShipping` consults the flat method price only when **no** line in the order carries a shipping rule. Every product in the catalogue carries one, so that branch is unreachable — and the checkout's shipping-method selector no longer decides anything. A shopper who picks "Cash In Delivery - Outside Dhaka — ৳160" is charged the `Default 1` rule's catch-all place instead: ৳80. The store is quoting one price and charging another, which is exactly the failure `order.pricing.ts` was factored out to prevent.

Nothing depends on the model yet: no order has been placed, no `Shipment` references a method, and no customer address exists. Removal costs nothing today and gets more expensive with every order placed against a column we intend to drop.

## What Changes

- **BREAKING: `ShippingMethod` is removed** — the Prisma model, its table, and the entire `/shipping-methods` route group (public list, admin list/detail, create, update, delete).
- **BREAKING: `Shipment.shippingMethodId` is dropped.** A shipment keeps `carrier`, `trackingNumber` and `status`, which is what actually identifies who is delivering it. The column and its index go.
- **BREAKING: `shippingMethodId` is removed from the checkout and quote payloads.** `POST /orders` and the quote endpoint no longer accept it; passing it is ignored by validation rather than honoured.
- **Delivery price comes solely from matched shipping places.** `quoteShipping` loses its `fallbackFlatPrice` argument and `IChargeQuoteInput` loses `fallbackFlatShippingPrice`.
- **An order in which no product carries a shipping rule is refused, not shipped free.** With the flat fallback gone the alternative is charging zero, which is a delivery the merchant pays for — the same reasoning that already makes an unmatched destination an error rather than a silent zero. `Product.shippingRuleId` is nullable and the product API does not require it, so this case is reachable and must be said out loud.
- **The storefront checkout loses its shipping-method radio group.** Delivery cost, delivery days and the collection option already come from the quote, computed from the shopper's address; the selector is replaced by that derived summary. Nothing the shopper is charged changes.
- **The admin loses Sales → Shipping Methods.** The list page, form page, route entries, nav item and API client are removed, and the order detail page's shipment form loses its Method select.

## Capabilities

### New Capabilities

None. This change removes a mechanism; the replacement capability (`admin/catalog-rules`) was specified by `align-admin-catalog-with-reference`.

### Modified Capabilities

- `api/checkout`: "Shipment and shipping method are tracked per order" currently requires that an order be assignable a `ShippingMethod` at checkout. That half of the requirement is removed — shipment tracking stays, method assignment goes — and is replaced by a requirement that delivery price derives solely from the shipping rules of the products being bought, including what happens when no product carries one.

## Impact

**`server/`**
- Removed model `ShippingMethod`; removed field `Shipment.shippingMethodId` and its index. A destructive migration: `DROP TABLE "ShippingMethod"` and `ALTER TABLE "Shipment" DROP COLUMN`. Safe to run now — verified 0 orders, 0 shipments carrying a method, 0 customer addresses.
- Removed module `src/app/module/shipping-method/` (all five files) and its `router.use("/shipping-methods", …)` mount.
- `order.pricing.ts`: `quoteShipping` drops its third parameter; `IChargeQuoteInput` drops `fallbackFlatShippingPrice`; the rule-less branch throws instead of returning a flat amount.
- `order.service.ts`: both the checkout and quote paths stop loading and validating a method; the shipment is no longer created with one.
- `order.validation.ts`, `order.interface.ts`, `shipment.validation.ts`, `shipment.interface.ts`, `shipment.service.ts`: the `shippingMethodId` field and the three `include: { shippingMethod: true }` clauses go.

**`admin/`**
- Deleted: `features/sales/shipping-methods/` and `lib/api/shipping-methods.ts`; the `shippingMethods` entry in `query-keys.ts`.
- `app-router.tsx` loses three routes and two lazy imports; `nav-config.ts` loses the Sales → Shipping Methods item.
- `lib/api/shipments.ts` drops `shippingMethodId`/`shippingMethod` from its types and its import of the deleted module.
- `order-detail-page.tsx` drops the Method select, the `useShippingMethods` query and the `shippingMethodId` schema field, and shows the shipment's `carrier` instead.

**`frontend/`**
- Deleted: `services/shipping.ts` and the `ApiShippingMethod`/`ShippingMethod` types in `types/order.ts`.
- `app/checkout/page.tsx` stops fetching methods and passing them down.
- `components/checkout/CheckoutForm.tsx`: the selector, `shippingMethodId` state, its place in the order fingerprint and its `canPlaceOrder` condition are removed; the delivery panel renders the quote's matched place, price and delivery days.
- The `/api/orders` and `/api/orders/quote` route handlers stop forwarding `shippingMethodId`.

**Not in scope**
- Authoring the merchant's real Inside/Outside Dhaka geography as places on a shipping rule. The current `Default 1` rule keeps its single ৳80 catch-all; splitting it is merchant data entry in `/catalog/shipping-rules`, not code. Flagged because the ৳160 tier disappears with the methods — though it is already not being charged.
- Matching a shipping place on `city`. Places match `country`/`state`, and a Bangladeshi address puts "Dhaka" in `city`; making the Dhaka split work end-to-end may need that, but it is a change to the matching rule and belongs on its own.
- Split shipments, which `shipment.service.ts` still treats as one-per-order.
