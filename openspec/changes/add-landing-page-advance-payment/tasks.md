## 1. The switch and the resolver

- [x] 1.1 Add `requiresAdvancePayment` (Boolean, default false) to `server/prisma/schema/LandingPage.prisma`, with a `///` comment stating that it decides only WHETHER to ask and never where the money goes. Verify `npx prisma validate`.
- [x] 1.2 Run the migration, then **delete the three trigram `DROP INDEX` lines** and carry forward the NOTE block. Verify by grepping the generated SQL for executable `DROP INDEX` and finding none.
- [x] 1.3 Add the field to `createLandingPageZodSchema` and to the three type copies. Verify `verify-landing-page-shapes.ts` passes and fails on a rename in one copy only.
- [x] 1.4 Add `resolveLandingAdvancePayment(page, checkoutConfig)` to `landing-page.service.ts`, returning the shop's block when BOTH switches are on and at least one account exists, and "not offered" otherwise (design.md Decision 1 — the page's switch is an AND, never an override). Verify all four combinations by unit call.
- [x] 1.5 Refuse the switch at SAVE when the shop has advance payment off or no accounts, naming what is missing and where it is configured. Verify each refusal and its message.

## 2. The quote

- [x] 2.1 Extend `ILandingPageQuoteResult` with `advanceOptions`, the same shape the shop's quote returns. Mirror into the storefront types. Verify both typecheck.
- [x] 2.2 Compute it in `quoteLandingPageOrder` by importing `splitAdvance` from `order.pricing.ts` — NOT by reimplementing the arithmetic (design.md Decision 3: this exact path has already had a quote/placement divergence once, and this time the shopper has already sent the money). Verify the imported function is the one called.
- [x] 2.3 Assert the two halves sum to the order total for both choices, including on a campaign whose delivery zone is free. Verify by script.
- [x] 2.4 Quote both choices regardless of the switch, so flipping it needs no re-fetch. Verify a campaign with the switch off still returns the figures.

## 3. The order

- [x] 3.1 Add the payment method and claim to `placeLandingPageOrderZodSchema`, reusing the claim shape `createOrderZodSchema` already defines rather than a second one. Verify a complete claim parses and half a claim is refused.
- [x] 3.2 Stop hardcoding `paymentMethod: "COD"` in `placeLandingPageOrder`; forward the method and claim to `OrderService.placeOrder`, which already validates the account, refuses a reused reference and computes the amount. Verify an order carrying a claim is created with a `PROCESSING` payment row.
- [x] 3.3 Refuse a claim on a campaign that does not ask for one, using the resolver from 1.4 rather than reading the switch directly. Verify the refusal and that no order is created.
- [x] 3.4 Verify the inherited protections still fire on this path: a reused transaction id is refused, an unknown account is refused, and a client-supplied amount is not honoured. Verify each by script.
- [x] 3.5 Confirm verification needs NO change — `isAwaitingPaymentVerification` is order-shaped and already covers a campaign claim (design.md Decision 4). Verify a campaign order with an unverified claim cannot be confirmed, and appears in the staff queue.
- [x] 3.6 Add `npx tsx scripts/verify-landing-advance-payment.ts` covering 3.2–3.5 on `__verify_*` rows with cleanup in a `finally`. Verify it passes.

## 4. The storefront

- [x] 4.1 Serve the resolved advance config on the public page read, so the form knows the accounts without a second request. Verify the payload carries it when offered and omits it when not.
- [x] 4.2 Render `AdvancePaymentSection` inside `LandingOrderForm` when the campaign offers it — the SAME component the shop checkout uses, imported not copied. Verify it renders identically in both places.
- [x] 4.3 Wire the claim draft, its errors and the quoted splits, following how `CheckoutForm` already does it. Verify switching payment choice re-states the amounts.
- [x] 4.4 Submit the claim with the order, and surface the server's refusals in their own words — reused transaction id, stale amount, unknown account. Verify each by forcing the condition.
- [x] 4.5 Confirm a campaign NOT asking for an advance renders the form exactly as it does today. Verify the rendered markup is unchanged for such a page.

## 5. Admin

- [x] 5.1 Add the switch to the landing page form, in the order-form section. Verify it saves and reloads.
- [x] 5.2 State the dependency where the switch is — that the accounts come from Checkout Setting — with a link to that page (design.md — Risks: the switch depends on settings edited elsewhere). Verify the link resolves.
- [x] 5.3 Disable the switch, with the reason shown, when the shop has advance payment off or no accounts, so the form cannot express what the API will refuse. Verify both states.

## 6. Verification

- [x] 6.1 Extend `verify-landing-page-shapes.ts` with the new field. Verify it fails on a rename in one copy only.
- [x] 6.2 Assert the feature-off path: a campaign with the switch off places an order through the identical code path it used before this change. Verify by script.
- [x] 6.3 Extend `seed-bangla-landing-page.ts` to enable the switch, so the form can be reviewed with the payment section rendered. Verify the section appears on the seeded page.
- [x] 6.4 Run both test suites, every landing and advance-payment verify script, and all three typechecks. Verify no regression.
