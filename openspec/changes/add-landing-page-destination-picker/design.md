## Context

See proposal.md — Why. This records only what the existing code forces.

Five facts shape the approach:

1. **`resolveDeliveryOption` is storefront-only** (`nextjs/src/lib/delivery-destination.ts:309`). It maps a destination to a `DeliveryZone`, then to one of the shop's delivery options by key. The backend never sees a destination — it receives a `deliveryOptionKey` and prices from that. That is true of the shop checkout today, and it is the shape this change follows rather than reopens.
2. **`CheckoutForm` already has the whole pattern**: derive an option, fall back to the cards on a refusal, keep exactly one key in force (`optionKeyInForce`), quote and submit against it. Around fifteen lines of coordination, already written and already reasoned about.
3. **`LandingPage.deliveryZones` is a required Json column**, seeded with two zones on create, read by `resolveDeliveryZone` in the landing service, and charged through `shippingOverride` — a path that deliberately bypasses `quoteShipping` and both waivers.
4. **`Order.shippingAddress.state` currently carries the campaign's zone LABEL**, written by `placeLandingPageOrder`. Shop orders carry the destination there instead.
5. **`DestinationField` is already shared** between the shop checkout and the saved-address form, and takes no view of which form is asking.

## Goals / Non-Goals

**Goals:**
- One price list. The shop's delivery options are it.
- One coordination pattern, not a second one shaped slightly differently.
- Past orders unchanged, including the zone labels already on them.

**Non-Goals:**
- Moving destination resolution server-side. See Decision 4.
- Keeping `deliveryZones` behind a flag. See Decision 2.
- Touching the shop checkout.

## Decisions

### Decision 1 — reuse the whole pattern, not just the field

`LandingOrderForm` takes `DestinationField`, `resolveDeliveryOption` and the derived-or-chosen coordination from `CheckoutForm` as they are. Not just the input: the refusal handling, the "cards are the way out, not the first question" ordering, and the single-key-in-force rule come with it.

Copying only the field would leave a second, subtly different answer to "what happens when the district is unserved" — and that answer is about money, on the page ad spend lands on.

**Where the two forms genuinely differ**, they keep differing: a campaign has no pickup option and no collection flow, so the `collecting` branch has no counterpart here. That is a real difference in what the page sells, not a shortcut.

### Decision 2 — `deliveryZones` is REMOVED, not deprecated

Dropped from the schema, the validation, the interface, the three type copies and the admin editor, in one change.

Leaving it behind a flag was considered and rejected. A dormant price list is one a merchant can still edit — they will edit it, it will do nothing, and the reason will be invisible. Worse, the two lists would disagree while both looked authoritative, which is the exact failure this change exists to end.

**The authored prices are NOT migrated into the shop's options.** A campaign charging ৳90 for ঢাকার আশেপাশে where the shop charges ৳100 has two rates, and only the merchant knows which is now correct. Silently picking one would set a price nobody chose — the same reasoning that keeps `DEFAULT_DELIVERY_ZONES` from seeding a made-up rate. The migration says so in its own comment, so the loss is visible in the record rather than discovered later.

### Decision 3 — the destination goes where the shop puts it

`shippingAddress.state` currently holds the campaign's zone label; it will hold the destination, as a shop order's does. Same column, same shape, so staff read one thing and the courier brief does not branch on which page produced the order.

**Past orders are untouched.** The label already written stays written — an order records what was agreed at the time, and a zone label is a true record of what that shopper actually chose.

### Decision 4 — resolution stays storefront-side, deliberately

The browser resolves the destination and submits an option key; the server prices from the key. That is what the shop checkout does today.

It is worth naming what that means: the server trusts the client's choice of key. It is not a hole — the key names one of the merchant's own options and the server charges that option's stored price, so the worst a client can do is pick a cheaper option the merchant configured, which they could equally do by clicking a card. But it is a boundary this change does not move, because moving it belongs to both paths at once and would mix a trust change into a UI change. Stated here so the next person does not read the omission as an oversight.

### Decision 5 — the quote and the placement take a destination-derived key

`quoteLandingPageOrder` and `placeLandingPageOrder` take `deliveryOptionKey` where they took `zoneKey`, and price through the shop's options rather than through `shippingOverride`.

Dropping `shippingOverride` on this path is the substantive part. It exists so a landing page can charge its own zone price with neither waiver applied; with the shop's options in force, a campaign order is priced exactly as a shop order is — **including the free-shipping threshold and a coupon's shipping waiver, which campaign orders previously never received**. That is a behaviour change worth stating: a campaign crossing the shop's free-delivery threshold will now get free delivery, where before it would not have.

## Risks / Trade-offs

**A campaign's delivery price changes on deploy** → Any campaign whose authored zones differed from the shop's options now charges the shop's figure. Unavoidable given one price list, and the direction is right (the shop's settings are where the merchant looks), but it is a live price change on live ads. The migration comment names it, and it belongs in the release note rather than being discovered from an order.

**Campaign orders gain the free-shipping threshold** → Stated in Decision 5. A merchant who set a threshold for the catalogue and never considered campaigns will start giving free delivery on them. Correct by the principle here — one delivery policy — and worth telling them.

**The district list is a fixed dataset** → A district or area missing from it resolves to `UNKNOWN_PLACE` and drops the shopper to the cards. That is already true at checkout; this widens the surface where it shows. The fallback exists precisely for it.

**More steps before the button on an ad landing page** → A searchable select is more work than tapping one of three cards. Against that: the shopper is no longer being asked a question about tariff bands they have no way to answer, and a wrong answer there is a wrong delivery charge on a real order.

## Migration Plan

1. **Storefront and service first, still reading `deliveryZones`** — no, explicitly not: the column goes in the same change, because a half-migrated state has two price lists live at once, which is the failure being removed. The steps below are ordered so that window never exists.
2. **Schema, service, storefront and admin together**, verified as one unit against a seeded campaign before deploy.
3. **The migration drops `deliveryZones` and says why nothing was migrated into the shop's options** — a merchant reading the record later must find the decision, not a gap.
4. **Watch for the three trigram `DROP INDEX` lines** and delete them, carrying the NOTE block forward.
5. **Rollback** is the migration down plus the previous build; there is no partial state to sit in. Orders placed in between keep their captured option key and label, both of which remain meaningful.

## Open Questions

- **Whether the destination field should sit above or below the package picker.** It changes no requirement and no data; settle it against the rendered form.
