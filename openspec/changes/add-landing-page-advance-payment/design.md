## Context

See proposal.md — Why. This records only what the existing code forces.

Five facts shape the approach:

1. **`placeLandingPageOrder` hardcodes `paymentMethod: "COD"`** (`landing-page.service.ts:984`) and passes it to `OrderService.placeOrder`, which already accepts a full claim and already records one. The landing path is the only thing standing between a campaign and advance payment.
2. **The landing quote returns no advance figures.** `ILandingPageQuoteResult` is seven scalars; the shop's quote adds `advanceOptions` computed by `splitAdvance` (`order.service.ts:1933`).
3. **`AdvancePaymentSection` is already decoupled.** It takes `{ config, splits, claim, errors, onChange, quoting }` and imports nothing from the shop checkout. It was written as a component, not as part of a page.
4. **The accounts live on `StoreSetting.checkoutConfig.advancePayment`** and are read by `GET /settings/public`, which the landing page's own route does not currently fetch.
5. **Verification is order-shaped, not checkout-shaped.** `isAwaitingPaymentVerification` asks about an order's payment rows; it has no idea which page produced the order, so a campaign order is already covered by it with no change.

## Goals / Non-Goals

**Goals:**
- One claim mechanism, two callers. No second implementation of anything.
- A campaign that does not ask for an advance runs the code path it runs today.
- The merchant configures accounts once.

**Non-Goals:**
- Touching the shop checkout. It is the working caller; this adds a second.
- A campaign-specific verification flow. See Decision 4.
- Per-campaign accounts. Rejected in the proposal and enforced by Decision 2.

## Decisions

### Decision 1 — one boolean on the page, the config read from the shop

`LandingPage.requiresAdvancePayment` is a nullable boolean defaulting to off. Everything else — whether the shop offers advance payment at all, and which accounts — comes from `StoreSetting.checkoutConfig.advancePayment`, read at page render and again at order placement.

The alternative, copying the account list onto the page, was rejected for a specific failure rather than on principle: a merchant running six campaigns updates a bKash number in five of them, and the sixth quietly takes money to a closed account for a week. Nothing detects that. One source means the failure cannot exist.

**The page's switch is an AND, not an override.** A campaign asks for an advance only when its own switch is on *and* the shop has it enabled with at least one account. So removing every shop account degrades every campaign to cash on delivery rather than leaving pages asking for money with nothing to show — which is the fallback the spec requires and the only safe direction to fail in.

### Decision 2 — the effective config is resolved once, server-side

A small resolver returns the config a campaign actually offers: the shop's block when both switches are on and accounts exist, otherwise "not offered". The page render, the quote and the placement all read it.

This is the same shape `resolveLandingPackage` already took for packages, and for the same reason: three callers that each decide independently is three chances to disagree, and the disagreement here is a page that shows a payment form the order endpoint then refuses.

### Decision 3 — the quote returns `advanceOptions`, computed by `splitAdvance`

`ILandingPageQuoteResult` gains the same `advanceOptions` shape the shop's quote returns, computed by importing `splitAdvance` rather than by reimplementing the arithmetic.

**This is not a stylistic preference.** The landing path has already had exactly this bug once: the quote priced an order differently from the placement, and every order from the page failed with a 409 for as long as a campaign ran (see the comment in `quoteLandingPageOrder`). An advance figure computed twice is the same bug in a new place, and this time the shopper has already sent the money by the time it fires.

Both choices are always quoted, even when the campaign does not ask for an advance — it is a pure derivation of a total the response already carries, and a quote that omitted them would have to be re-fetched the moment a merchant flipped the switch.

### Decision 4 — the claim rides the existing override, and verification is untouched

`placeLandingPageOrder` stops hardcoding COD and forwards the method and claim into `OrderService.placeOrder`, which validates the account, refuses a reused reference, computes the amount and writes the `PROCESSING` payment row. None of that is reimplemented.

Verification needs **no change at all**, and that is worth stating rather than discovering: `isAwaitingPaymentVerification` queries an order's payment rows and knows nothing about landing pages, so a campaign claim is already blocked from advancing and already appears in the staff queue. A separate campaign flow would have been a second way to confirm money arrived, which is precisely the thing the original change refused to allow.

### Decision 5 — the landing page fetches the shop settings it already needs

The `(landing)` route does not currently read `/settings/public`. It will have to, to know the accounts — but it already reads them for `currency` and the shop-wide pixel, so this is one more field off a payload the page fetches anyway rather than a new round trip.

## Risks / Trade-offs

**A campaign asking for an advance converts worse than one that does not** → Certain, and the point: the shoppers it loses are disproportionately the ones who would have refused the parcel. Worth saying to the merchant plainly in the admin rather than letting them discover it as a drop in orders.

**The switch depends on settings edited elsewhere** → A merchant can turn advance payment off shop-wide and silently change what six campaigns do. Mitigated by the degradation being the safe direction (to cash on delivery, never to a broken form) and by the admin stating the dependency where the switch is, with a link to the settings that govern it.

**Shopper sends money, then placement fails on stock** → Inherited from the shop checkout and unchanged here: stock is validated before the claim is accepted, so the common failure happens before they are asked to pay. It cannot be eliminated while the money moves out-of-band.

**More surface on the highest-traffic page** → A campaign page is what ad money lands on, and this adds a form section to it. The section is the same component the shop checkout renders, so it is not new code on a hot path — but it is more of the page between the shopper and the button.

## Migration Plan

1. **Schema first**, one nullable boolean defaulting to off. No backfill; every existing campaign reads as "does not ask", which is what it is.
2. **Quote, then placement, then the page.** The figures must be available before the form can show them, and the endpoint must accept a claim before the form can send one.
3. **Admin last**, since the switch must be storable before it is editable.
4. **Rollback** is turning the switch off, which returns the campaign to cash on delivery immediately. Orders already carrying a claim keep it and stay in the verification queue.

## Open Questions

- **Whether the admin should warn about the conversion trade-off** (Risks, first entry) as a line under the switch or leave it to documentation. It changes no requirement; settle it when the admin work is done and the wording can be seen in place.
