## Context

See proposal.md — Why, for the motivation. What matters for the approach:

- `StoreSetting.checkoutConfig` is a `Json?` column, validated whole by `checkoutConfigSchema`, written whole by one admin page, and **already merged into the public settings projection** (`store-setting.service.ts:125`). Every storefront page therefore already carries it.
- `ShippingRule` (unique name) owns `ShippingPlace[]` (`name`, `country`, `state`, `price`, `deliveryDays`, `offersPickup`, `pickupPrice`), and `Product.shippingRuleId` points at a rule with `onDelete: Restrict`.
- `quoteShipping(lines, destination)` groups the basket by rule, calls `matchPlace` per rule, and **sums** the matches. It throws when a rule matches nothing and when no line carries a rule at all.
- `Order` stores `shippingAmount` but has **no** delivery-method column — pickup versus delivery is passed into pricing and then discarded. Nothing on an order references a rule or place, so removing those tables orphans nothing.
- The campaign landing page already models this correctly and separately: `LandingPage.deliveryZones` is `Json` holding `[{ key, label, price }]`, the shopper picks one, and that price is charged.

## Goals / Non-Goals

**Goals:**

- One place to configure delivery, reachable where a merchant already configures the checkout.
- The shopper's choice is explicit and priced exactly as chosen — no inference from typed text.
- Delete more code than is added. `matchPlace`, the most-specific-first ordering, three validations and a whole server module should go.

**Non-Goals:**

- Unifying landing-page `deliveryZones` with the shop's options. They are a per-page offer stated before an address exists; folding them together is a separate change.
- Per-product or weight-based delivery pricing. Removing it is the point; a merchant needing it is not served by this design.
- Enabling and disabling an option without deleting it. A short list a merchant edits directly does not need a lifecycle.
- Free-delivery thresholds, per-option minimum spend, or courier integration.

## Decisions

### D1 — Options live in `checkoutConfig`, not a new table

Delivery options become an array inside the existing `checkoutConfig` JSON, each with a stable `key`:

```
checkoutConfig.delivery = {
  offersPickup: boolean,
  options: [{ key, label, kind: "DELIVERY" | "PICKUP", price, days }]
}
```

*Why:* the merchant asked for this to be controlled from Checkout Settings, and `checkoutConfig` is precisely that setting — already validated whole, already audited through the settings PATCH, and **already in the public projection**, so the storefront gets the options with no new request and no new endpoint. A table would mean a new Prisma model, a new server module (route, controller, service, validation, interface), a new admin API client, a new query key, and its own audit wiring — to hold four fields a merchant edits perhaps twice a year. The landing page already proves the JSON-array shape works for exactly this.

*Alternative considered:* a `DeliveryOption` table with `Order` holding a foreign key. Rejected — the only thing a FK buys over the captured label is grouping orders by option for reporting, and the codebase's own precedent for that case (`landingPageId` + `landingPageTitle`) is a key alongside a captured title, which the `key` field below gives us without a table.

*Consequence to accept:* the option list is rewritten whole on every settings save, so two admins editing checkout settings concurrently can clobber each other's option edits. That is already true of every other field on that page and is not made worse here.

### D2 — `key` is a stable slug, and it is what the order references

Each option carries a `key` the merchant never sees, generated once when the option is created and never rewritten — renaming the label does not change the key. The order stores the key **and** a captured label.

*Why:* the key answers "how many orders chose Inside Dhaka" across a rename; the captured label answers "what did this shopper actually agree to", which must not move when the merchant edits the list. This is the same two-column split as `landingPageId` / `landingPageTitle`, for the same reason.

*Alternative considered:* referencing options by label alone. Rejected — a rename would silently re-bucket historical orders, and two options could not be told apart across an edit.

### D3 — `quoteShipping` becomes a lookup, not a matcher

`matchPlace` is deleted. `quoteShipping(lines, destination)` becomes `quoteDelivery(selectedKey)`: find the option by key, return its price. The per-rule grouping and summing goes with it, because delivery is now charged once per order.

The two throws change meaning rather than disappearing:

- "no line carries a rule" → "the store has no delivery options configured", a merchant misconfiguration reported as one.
- "this rule matches nothing at that destination" → "that delivery option no longer exists", which is a stale client, not an undeliverable address.

*Why:* the basket no longer influences delivery pricing at all, so nothing needs to be grouped. Lines stay a parameter only for the rest of the quote (subtotal, tax).

### D4 — Pickup suppresses address requirements at validation, not just in the UI

`collectMissingCheckoutFields` already decides which address fields an order must carry. When the chosen option is a pickup point, the address fields are treated as not required, server-side, regardless of the merchant's field configuration. Name and phone stay required.

*Why:* hiding the fields in the form alone would leave the server rejecting a valid collection order, which is the failure the existing checkout-config spec is careful about. The rule belongs where the decision is already made.

### D5 — `offersPickup` off means the server refuses pickup, not just that the UI hides it

The toggle is enforced in order validation, not only in rendering.

*Why:* a setting a merchant switched off must not be reachable by replaying an older request body. Cheap to check — the setting is already loaded to validate the address fields.

### D6 — Order gains three columns, all nullable

`deliveryMethod` (`DELIVERY` | `PICKUP`), `deliveryOptionKey`, `deliveryOptionLabel`. Nullable because orders placed before this change have none, and because landing-page orders are priced outside this system.

*Why:* the store cannot currently tell a collection order from a delivered one — the distinction is computed at checkout and thrown away. Staff dispatching orders need it, which is why the spec requires it.

### D7 — Migration backfills from the places that exist, then drops the tables in a second step

The Prisma migration adds the new columns and leaves `ShippingRule`/`ShippingPlace`/`Product.shippingRuleId` in place. A script reads every `ShippingPlace`, dedupes by name, and writes the resulting list into `checkoutConfig.delivery.options` — `offersPickup: true` places become `PICKUP` options priced at their `pickupPrice`, the rest become `DELIVERY` options at `price`. Only once that has run and been checked does a second migration drop the tables and the column.

*Why:* a single migration that both derives data and drops its source cannot be inspected between the two, and cannot be rolled back once the source is gone.

*Note for this store specifically:* the existing rule set is a single rule whose places are all catch-alls, so the backfill produces exactly the flat list the merchant was trying to author. A store that had used per-product rules to charge differently for different products would collapse to one list, and would have to choose one price per area — that loss is inherent to the change and is called out as BREAKING in the proposal.

## Risks / Trade-offs

**A shopper mid-checkout during deploy submits the old payload shape** → Their order is refused with a validation error rather than being mispriced. The checkout re-reads settings on load, so a refresh recovers. Deploy at low traffic; do not attempt to accept both shapes, which would mean two pricing paths live at once — the exact ambiguity this change removes.

**Two parallel delivery models remain** (shop options and landing-page zones) → Accepted for now and recorded as a non-goal. The risk is a merchant changing shop delivery prices and expecting landing pages to follow. Mitigate with a line on the landing-page editor saying its zones are its own.

**Delivery is no longer per-product** → A merchant selling something genuinely costlier to ship loses the ability to charge for it. Accepted: it was not reachable in practice anyway, since guests never matched anything but the catch-all.

**The option list is rewritten whole on save** → See D1. Same exposure as every other field on that page.

**Deleting an option a shopper has open in their browser** → Their submission is refused with "choose again" rather than being charged a stale price. Covered by a spec scenario.

## Migration Plan

1. Add `checkoutConfig.delivery` to the schema and defaults, defaulting to an empty option list with `offersPickup: false`. Ship it — nothing reads it yet.
2. Add the three nullable `Order` columns.
3. Run the backfill script; check the resulting option list in Checkout Settings against the old shipping rules.
4. Switch the quote and order paths, the admin page and the checkout over in one release.
5. After a soak, drop `ShippingRule`, `ShippingPlace` and `Product.shippingRuleId`, and delete the shipping-rule module and its Postman folder.

**Rollback:** before step 5 the old tables are intact and the old module can be restored by reverting the release; the new `checkoutConfig.delivery` key is ignored by the old code, since `checkoutConfigSchema` is strict but the old build never receives the new shape from an old server. After step 5, rollback means restoring from backup — which is why step 5 waits.

## Open Questions

- Should a pickup point carry a short address or opening-hours line shown at checkout, rather than just a name? Additive and deferrable: it is one more optional field on an option, and it changes no decision here.
- Should the delivery charge be suppressed entirely above an order value threshold (free delivery)? Frequently wanted in this market, but it is its own feature with its own spec.
