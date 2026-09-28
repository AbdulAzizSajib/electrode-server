## Why

`add-district-area-picker` replaced the shop checkout's free-text City box with a searchable district-and-area picker, and made the delivery charge follow from what the shopper chose. A campaign landing page still asks the old question: three radio cards — `ঢাকার ভিতরে ৳60`, `ঢাকার আশেপাশে ৳90`, `ঢাকার বাইরে ৳120` — that the shopper answers about themselves.

Two problems, and the second is the expensive one.

**The shopper is asked to classify their own address.** Someone in Savar is guessing whether that counts as "আশেপাশে" or "বাইরে", and the ৳30 between those is the merchant's money either way. A district picker does not ask them to judge; it asks where they live and works the rest out.

**The two order paths now disagree about what delivery costs.** The shop derives the charge from the shop's own delivery options; a campaign carries its own `deliveryZones`, authored per page. The same customer at the same address pays one figure through the catalogue and another through an ad, and a merchant raising their outside-Dhaka rate in Checkout Setting changes only one of them. That is not a display inconsistency — it is two price lists for one shop, and only one of them is where the merchant looks.

## What Changes

- **A campaign asks for a district and area, not a zone.** The same `DestinationField` the shop checkout uses, with the same searchable list, on the campaign's order form.
- **The delivery charge is derived, not chosen.** `resolveDeliveryOption` maps the chosen destination to one of the shop's own delivery options, exactly as it does at checkout. The shopper sees the charge; they do not pick it.
- **The shop's delivery options become the single price list.** A campaign no longer authors delivery prices. Raising the outside-Dhaka rate in Checkout Setting raises it everywhere, including on every live campaign.
- **BREAKING:** `LandingPage.deliveryZones` is removed, and with it the per-campaign editor. Orders already placed keep the zone label captured on them, so no history is rewritten.
- **The cards remain as the way out, not the first question.** Where a destination resolves to nothing the store has configured — an unserved district, a missing option — the shopper is shown the shop's delivery options to choose from, with the reason stated. Same fallback the shop checkout already has.

## Capabilities

### New Capabilities
<!-- None. This is the existing destination picker reaching a second order
     path, and the landing page losing a price list it should not have had. -->

### Modified Capabilities
- `storefront-cms/landing-pages`: Removes per-campaign delivery zones; the campaign's delivery charge comes from the shop's own options.
- `commerce/landing-page-orders`: The order carries a destination and a resolved delivery option rather than a campaign zone key, and is priced by the shop's options.

## Impact

**Schema (migration required)**
- `LandingPage.deliveryZones` is dropped. Its authored prices are not migrated into anything — the shop's options replace them, and a merchant whose campaign charged a different rate must decide which rate is now correct rather than have one picked for them. **That is a deliberate merchant-facing consequence, not a silent data change**, and the migration is written to make it visible.
- `Order` keeps `deliveryOptionKey`, `deliveryOptionLabel` and the zone label already captured on past orders. Nothing historical moves.

**Code**
- `server/src/app/module/landing-page/` — `resolveDeliveryZone` is deleted; the quote and the placement resolve the shop's options instead, and take a destination rather than a zone key.
- `nextjs/src/components/landing/LandingOrderForm.tsx` — renders `DestinationField`, falls back to the option cards on a refusal, exactly as `CheckoutForm` does.
- `nextjs/src/lib/delivery-destination.ts` — unchanged. It is already shared, storefront-side, and knows nothing about which form is asking.
- `admin/` — the delivery-zones editor is removed from the landing page form, with a line saying where delivery is configured now.

**Explicitly out of scope**
- **Moving destination resolution to the backend.** Today the storefront resolves and submits an option key, and the server prices from that key — for both paths. That split predates this change and is left alone; doing both at once would mix a UI change with a trust-boundary change.
- **Per-campaign delivery pricing in any form.** It is the thing being removed. A merchant who genuinely needs a campaign-specific rate needs a delivery option for it in Checkout Setting, where every other price lives.
- **Changing the shop checkout.** It is the working caller; this makes the campaign match it.
