## Why

`add-advance-payment-checkout` built the whole mechanism — the merchant's accounts, the claim a shopper submits, the staff verification that releases the order — and wired it into the shop's checkout. A campaign landing page cannot use any of it. `placeLandingPageOrder` hardcodes `paymentMethod: "COD"`, and the landing quote returns no advance figures, so the page has nothing to show and no way to submit a claim.

That is the wrong way round. Advance payment exists to make a fake order cost the person placing it something, and **landing-page traffic is where fake orders come from**: paid ads, a shopper who has known the shop for thirty seconds, no account, nothing at stake. The shop's own checkout — reached by people who browsed, added to a cart, and came back — is the lower-risk path of the two, and it is the only one protected.

Everything needed already exists. `AdvancePaymentSection` takes a config, the quoted splits and a claim draft, and knows nothing about the shop checkout it currently sits in. `OrderService.placeOrder` already accepts a claim and already records it. What is missing is the landing page asking for one.

## What Changes

- **A landing page can take advance payment, per campaign.** A new switch on the page: when on, the order form offers the same two choices the shop checkout does — delivery charge in advance, or the full total — and collects the same sender number and transaction id.
- **The accounts stay shop-wide.** The merchant's bKash, Nagad and bank details remain in Checkout Setting, configured once. A landing page chooses *whether* to ask, never *where the money goes* — so changing a number reaches every campaign at once, and there is no second copy to fall out of step.
- **The landing quote returns the advance figures.** `POST /landing-pages/by-slug/:slug/quote` gains the per-choice split the shop's quote already returns, so the page can state "send ৳60 now, ৳1,299 on delivery" before asking for a transaction id.
- **The landing order accepts a claim.** `placeLandingPageOrder` stops hardcoding COD and passes the claim through to `OrderService.placeOrder`, which already knows what to do with one. **BREAKING for the landing order payload:** it gains an optional payment method and claim, refused when the campaign or the shop has not enabled advance payment.
- **The same component renders it.** `AdvancePaymentSection` is reused as-is rather than reimplemented, so a shopper sees one thing in both places and a fix to either reaches both.
- **A campaign with the switch on but nothing configured shop-wide is refused at save**, the way enabling it shop-wide with no accounts already is — otherwise the page asks for money with nowhere to send it.

## Capabilities

### New Capabilities
<!-- None. This is the existing advance-payment capability reaching a second
     order path, and the existing landing page gaining a switch. -->

### Modified Capabilities
- `storefront-cms/landing-pages`: Adds the per-campaign advance-payment switch, its dependence on the shop-wide accounts, and the rule that it cannot be enabled without them.
- `commerce/landing-page-orders`: Adds the advance-payment claim to a landing-page order — what the quote must return, what the order may carry, and what is refused.

## Impact

**Schema (no migration)**
- `LandingPage.checkoutConfig` does not exist; the switch is a scalar. `LandingPage` gains one nullable boolean, additive and defaulting to off, so every existing campaign is unchanged.

**Code**
- `server/src/app/module/landing-page/` — `quoteLandingPageOrder` returns the split (computed by the same `splitAdvance` the shop quote uses, never a second implementation); `placeLandingPageOrder` stops hardcoding COD and forwards the claim; validation gains the claim shape it already has on `createOrderZodSchema`.
- `nextjs/src/components/landing/LandingOrderForm.tsx` — renders `AdvancePaymentSection` when the campaign offers it, and submits the claim.
- `admin/src/features/ui/landing-pages/` — the switch, with a line saying where the accounts are configured and a link to it.
- Three hand-synced type copies; `verify-landing-page-shapes.ts` already guards them.

**Explicitly out of scope**
- **Per-campaign accounts.** Deliberately rejected: a merchant maintaining the same bKash number in six campaign pages will eventually update five of them, and the sixth takes money to a closed account. The accounts are shop-wide and stay there.
- **A different verification flow for landing orders.** A claim from a campaign page is verified by the same staff action, in the same queue, as one from the shop checkout. There is one way to confirm money arrived.
- **Changing what the shop checkout does.** This change adds a second caller to an existing mechanism; the first one is untouched.
