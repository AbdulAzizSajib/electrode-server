## Context

See proposal.md — Why. The facts that shape the approach:

- `quoteShipping(lines, destination, fallbackFlatPrice)` uses the flat price only when `ruleIds.length === 0`. Every catalogue product carries `shippingRuleId`, so that branch is dead code in production and the checkout selector decides nothing.
- `Product.shippingRuleId` is nullable and `product.validation.ts` marks it `.optional()`, so a rule-less product *can* be created. The dead branch is reachable in principle even though nothing reaches it today.
- The database is empty of anything that depends on the model: 0 orders, 0 shipments carrying a `shippingMethodId`, 0 customer addresses. The only rows are the two `ShippingMethod` records themselves and one `ShippingRule` ("Default 1", a single catch-all place at ৳80 / 3 days).
- `validateRequest` strips unknown keys rather than rejecting them, so a field removed from a zod schema is silently ignored on the wire — no client needs to be updated in lockstep.
- `Shipment` already carries `carrier` as free text, so removing the method reference does not lose the ability to record who delivered a parcel.

## Goals / Non-Goals

**Goals:**
- One source of delivery price. After this change there is no code path in which a delivery amount comes from anywhere but a matched `ShippingPlace`.
- No dead schema. The table and column go with the code, so nothing is left for a future reader to mistake for a live mechanism.
- Removal is behaviour-preserving for money. What a shopper is charged today (the matched place's price) is what they are charged after.

**Non-Goals:**
- Changing how places are matched. `matchPlace`'s most-specific-first ordering and its `country`/`state` inputs are untouched.
- Building a shopper-facing chooser among a rule's places. See Decisions.
- Backfilling the ৳160 tier as a place. That is merchant data entry, and doing it in code would guess at a geography boundary the address model cannot currently express.

## Decisions

### An order in which no product carries a shipping rule is refused

With the flat fallback gone, `ruleIds.length === 0` needs an answer. Three were considered:

1. **Return zero.** Rejected. `quoteShipping` already refuses to do this for an unmatched destination, on the stated grounds that quietly charging zero is a delivery the merchant pays for. The same reasoning applies more strongly here — no rule at all is less information than a rule that missed.
2. **Keep a flat fallback on `StoreSetting`.** Rejected. It reintroduces exactly the defect being removed: a second place a delivery price can come from, which will drift from the rules and be forgotten until it silently prices an order.
3. **Throw a 400 naming the problem.** Chosen. It is loud, it is consistent with the neighbouring failure, and the condition is a merchant misconfiguration (a product saved without a rule) that someone must fix rather than absorb.

The message names the products, not the rule, following the precedent already in `quoteShipping`: a shopper has never heard of the rule but knows what they put in their basket.

Note this only fires when *every* line is rule-less. The existing "rides along" behaviour for a single rule-less product among others is deliberately preserved — that product travels in a parcel already being paid for.

### The storefront shows a derived delivery summary, not a new selector

The obvious symmetry — replace the method radio group with a radio group over the rule's places — is wrong. A place is *matched* to the shopper's address, not chosen by them. Offering the list would let a shopper pick the ৳80 city rate for a rural address, which is the flat-price problem inverted.

So the panel becomes read-only: the matched place's name, its price, and its delivery days, all of which the quote already returns in `shipping.matches` and `deliveryDays`. The one genuine choice the shopper still has — collect in person instead — stays, because it is a different service and is already gated on `pickupAmount !== null` rather than on any method.

This also removes `shippingMethodId` from the checkout's `canPlaceOrder` condition, which today blocks a signed-in shopper from ordering until a method is selected. Nothing replaces it: there is no selection left to make.

### The shipment is created when the order is dispatched, not at checkout

Today the shipment row is created during checkout, but only as a side effect of a method being picked: `payload.shippingMethodId ? { shipments: { create: … } } : {}`. Removing the method removes the trigger, so the behaviour has to be chosen rather than inherited.

Creating an empty `PENDING` shipment for every order was considered and rejected: it would mean every order claims a dispatch that has not happened, and `ShipmentService.createShipment` — which exists precisely so an admin can open one — would then always fail with "This order already has a shipment".

So checkout creates no shipment. The admin creates it when the parcel actually goes out, which is what the order detail page's shipment form already does and what the spec's "once dispatched" wording describes. `getOrderShipment`'s existing "This order has no shipment yet" 404 already covers the interval before that.

### Drop the table and column rather than deprecating in place

The alternative is leaving `ShippingMethod` and `Shipment.shippingMethodId` in the schema, unwritten. Rejected: a nullable column nobody writes is indistinguishable from one that is merely rarely written, and the next person to read the schema has to reconstruct this whole story to know which. With 0 dependent rows the drop is free now and never gets cheaper.

The migration is a plain `DROP TABLE` plus `ALTER TABLE ... DROP COLUMN`, with the `Shipment_shippingMethodId_idx` index going with the column.

### Removed request fields are dropped from validation, not rejected

`shippingMethodId` comes out of `order.validation.ts` and `shipment.validation.ts` rather than being kept and explicitly refused. Because `validateRequest` strips unknown keys, a stale client that still sends it gets a working order priced from the rules — which is what the spec requires ("it has no effect") and is strictly kinder than a 400 the shopper cannot act on.

### Signature change over a defaulted parameter

`quoteShipping` loses its third parameter outright rather than defaulting it to `0`, and `IChargeQuoteInput` loses `fallbackFlatShippingPrice`. A defaulted parameter would leave every call site compiling while silently meaning something new; removing it makes the compiler point at all three callers.

## Risks / Trade-offs

- **The ৳160 "Outside Dhaka" tier disappears from the admin.** → It is already not being charged — the rule's ৳80 catch-all is what every shopper pays today, so no price changes. The merchant re-creates the tier as a second place on `Default 1` in `/catalog/shipping-rules`. Called out in the proposal's Not-in-scope so it is not discovered later as a regression.
- **The Dhaka split cannot actually be expressed yet.** → `ShippingPlace` matches on `country`/`state`, and `CustomerAddress` puts "Dhaka" in `city` with `state` optional. A merchant authoring `country=Bangladesh, state=Dhaka` will not match an address that only filled in `city`. This change does not make that worse (nothing matches on city today either), but it does remove the workaround people were using. Matching on city is its own change.
- **A product saved without a shipping rule now breaks its own checkout.** → Previously it fell through to a flat price; now an all-rule-less basket 400s. The trade is deliberate (see Decisions) and the failure is loud rather than a silent mispricing. The product form already offers a shipping rule field; making it required at the API level is the natural follow-up if this ever fires.
- **Three packages must move together.** → The admin and storefront break at compile time if the server module goes first, which is the good failure. The DB migration must land *with or after* the code that stops selecting `shippingMethod`, since Prisma's `include` would otherwise query a dropped column. With 0 live orders there is no deploy window to protect, so the whole change ships as one unit.

## Migration Plan

1. Server code first: remove the module and mount, strip `shippingMethodId` from order/shipment interfaces, validation and services, and change `quoteShipping`/`quoteCharges`. The build must be green before the schema moves.
2. Prisma schema: delete `ShippingMethod.prisma`, remove the relation block and index from `Shipment.prisma`, then generate a migration that drops the table, the column and the index.
3. Admin and storefront: delete the pages, API clients, types and the checkout selector.
4. Verify against the real database that a checkout still prices from the matched place, and that an all-rule-less basket is refused.

**Rollback**: revert the code and `prisma migrate resolve` the dropped migration. The two `ShippingMethod` rows are not recoverable from the migration, so their values — `Cash In Delivery - Inside Dhaka` ৳80 and `Cash In Delivery - Outside Dhaka` ৳160 — are recorded here and in the proposal for re-entry as places. Nothing else referenced them.
