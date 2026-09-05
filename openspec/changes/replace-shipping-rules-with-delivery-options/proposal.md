## Why

A merchant cannot express the delivery setup almost every Bangladeshi shop runs — *Inside Dhaka ৳60 / Outside Dhaka ৳120 / collect from one of our pickup points*. Shipping is modelled as an international carrier problem: a rule is a set of **places** matched against the shopper's `country` and `state`, most specific first.

Two things make that unusable in practice:

- **The match cannot reach anything but the catch-all.** `matchPlace` only considers a region or a country when the destination carries a `country`, and the guest checkout never collects one — it sends the City field as `state` and no country at all. Every guest therefore falls through to the "everywhere else" place. A signed-in shopper's saved address defaults `country` to `"Bangladesh"`, so the *same address* can be priced differently depending on whether they were logged in.
- **The only way to author two areas is rejected.** Because Label does not take part in matching, "Inside Dhaka" and "Outside Dhaka" both key to `*|*` and the service refuses them with *"Two places cover the same destination"* — which is the error a merchant actually hits when they try to set this up.

The evidence that the model is wrong is already in the codebase: the campaign landing page does not use shipping rules at all. It carries its own `deliveryZones` — `[{ key, label, price }]`, shopper picks one, that price is charged — precisely because, as its own comment says, "the page collects no country or region to match on".

This change makes that the model for the whole shop: the merchant names a few delivery options, and the shopper picks one.

## What Changes

- **BREAKING** — Delivery options become **store-wide**. A single ordered list serves the whole shop, replacing per-product delivery policies. `Product.shippingRuleId` is removed, and an order is charged for delivery **once** rather than once per distinct rule in the basket.
- **BREAKING** — `ShippingRule` and `ShippingPlace` are replaced by a list held in the store's existing `checkoutConfig`: each option is a name, a price, a delivery-time estimate, and whether it is a home delivery or a pickup point. `country` and `state` are gone, and with them destination matching.
- **BREAKING** — the `/shipping-rules` endpoints are removed outright rather than replaced. Delivery is saved through the settings endpoint that already serves the checkout configuration, so the whole `shipping-rule` server module and its admin API client are deleted, not rewritten.
- Delivery moves to **Checkout Settings**, beside the other decisions about what the checkout asks for. The merchant edits the option list there, and the standalone shipping-rules page under Catalog is removed — delivery is a checkout decision, not a catalogue one.
- Checkout Settings gains a **toggle for collection in person**, alongside the existing field, coupon-box and guest-checkout switches. Off, the checkout offers the delivery areas alone and no pickup step appears — the common case of a shop that only delivers. On, the shopper gets the choice.
- The shopper chooses their delivery option at checkout, in two steps: first home delivery or collection in person, then which area or which pickup point. Nothing is inferred from their address. With pickup turned off, the first step is skipped entirely and the shopper picks straight from the delivery areas.
- Choosing a pickup point stops the checkout asking for a delivery address, since there is nothing to deliver to.
- The order records the chosen option's name and price as a snapshot, so an order stays readable after the merchant renames or deletes that option.
- Three validations disappear, because the situations they guarded against no longer exist: *"names a region but no country"*, *"Two places cover the same destination"*, and *"sets a pickup price but does not offer pickup"*. So does `matchPlace` and the whole most-specific-first ordering it required.
- The admin's shipping-rule form loses its Country and Region columns and becomes a flat, reorderable list of named options.

Existing shipping rules are migrated: every place becomes a delivery option carrying its name, price and delivery days, with places that offered pickup becoming pickup points. Orders already placed are unaffected — they snapshot their own delivery amount and hold no reference to a rule.

## Capabilities

### New Capabilities

- `commerce/delivery-options`: What delivery choices a merchant offers and where they are configured, how a shopper picks one at checkout, and how that choice is priced, validated and recorded on the order. Covers home-delivery areas, collection-in-person points, and the setting that governs whether collection is offered at all.

### Modified Capabilities

None writable in this OpenSpec root. `openspec/specs/` is empty — every capability this change touches is still specified inside an unarchived change, so there is no main spec to write a delta against. Three sets of requirements are superseded and should be reconciled when their own changes archive:

- `openspec/changes/add-checkout-and-site-settings/specs/storefront-cms/checkout-config/spec.md` (also extended by `add-currency-format-and-home-content-cms`) — the checkout-configuration requirements gain the collection-in-person toggle and the option list. This one is in *this* root and is the closest thing to a modified capability; it is listed here rather than as a delta only because it has not been archived into `openspec/specs/` yet.
- `server/openspec/changes/remove-shipping-methods/specs/api/checkout/spec.md` — *"Delivery price is derived from the shipping rules of the products being bought"* and *"An order no product of which carries a shipping rule is refused"*
- `frontend/openspec/changes/align-admin-catalog-with-reference/specs/admin/catalog-rules/spec.md` — *"A shipping rule is a named set of places"*, *"The most specific matching place wins"*, *"A rule products still use cannot be deleted silently"*

## Impact

**Database** — `StoreSetting.checkoutConfig` gains the option list and the collection-in-person flag; `ShippingRule`, `ShippingPlace` and `Product.shippingRuleId` dropped after a backfill script carries the existing places across. `Order` gains three nullable columns recording what was chosen; no existing order column changes meaning.

**Server**
- `module/shipping-rule/*` deleted entirely, along with its mount in `app/routes/index.ts`
- `module/store-setting/*` — `checkoutConfig`'s schema, defaults and public projection carry the option list and the new flag
- a backfill script under `scripts/`
- `module/order/order.pricing.ts` — `matchPlace` and the destination-matching half of `quoteShipping` removed; pricing keyed on the selected option
- `module/order/order.service.ts`, `order.validation.ts`, `order.interface.ts` — the quote and place-order payloads carry a delivery option instead of a destination
- `module/product/*` — the shipping-rule field leaves the product payload and its validation
- `scripts/verify-checkout-totals.ts`, `verify-catalog-change.ts`, `verify-currency-and-content.ts`, `verify-landing-page.ts`, `verify-site-settings.ts`

**Admin** — the delivery-option editor and the collection toggle land on `features/ui/checkout-settings/checkout-settings-page.tsx`; `features/catalog/shipping-rules/*` and `lib/api/shipping-rules.ts` are deleted along with their route in `routes/app-router.tsx`, their entry in `routes/nav-config.ts` and their query keys; the shipping-rule picker is removed from `features/catalog/products/product-form-page.tsx`; `lib/api/store-settings.ts` carries the new settings shape.

**Storefront** — `components/checkout/CheckoutForm.tsx` gains the two-step chooser, honours the collection toggle, and stops sending City as `state` for pricing; `types/order.ts`, `types/store-settings.ts`.

**API docs** — the Postman collection drops its `/shipping-rules` folder, and the settings and checkout quote/order bodies change shape.

**Not affected** — campaign landing pages keep their own `deliveryZones`. They are per-page offers stated before an address is collected, which is a different thing from the shop's standing options, and unifying them is out of scope here.
