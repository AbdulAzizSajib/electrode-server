## Context

See proposal.md — Why. What matters for the approach is which pieces already exist and which do not.

**Already built, reusable as-is.** `Cart.guestToken` and `optionalAuth` were introduced for `api/cart-wishlist` and do exactly what checkout needs. `resolveCart` mints a guest cart on first touch; `mergeGuestCartIntoCustomerCart` folds it into a customer's cart on login. `optionalAuth` never throws — any missing, expired, or malformed credential falls through to `next()` without setting `req.user`. `Customer.userId` is already `String? @unique`, so a customer without a user account is a shape the schema permits today. `PaymentMethod.COD` already exists.

**Already built, but the wrong shape.** `placeOrder` takes `userId: string` as its first parameter and immediately calls `getOrCreateCustomerByUserId`. Everything after that — cart lookup, address ownership check, idempotency replay, stock deduction, coupon redemption — operates on the resolved `customer.id` and needs no change. The identity resolution is the only part that is session-bound.

**Not built at all.** Phone-based customer resolution. Payload-carried addresses. Any `Payment` row creation at checkout (`placeOrder` creates none today — the `payments` relation is only ever read). Rate limiting of any kind; no rate-limit library is in `package.json`.

**Constraint that shapes several decisions.** `Customer.phone` is `String?` with a non-unique `@@index`. Making it a merge key requires a unique constraint, and existing rows may already violate it.

## Goals / Non-Goals

**Goals:**
- One checkout endpoint serving both guest and authenticated flows, so pricing, stock, coupon, and idempotency logic have exactly one implementation.
- Guest identity resolution that makes a repeat buyer one customer record rather than N.
- Abuse limits that fail before stock is touched.

**Non-Goals:**
- Reusing the request-level rate limiting for anything beyond guest checkout.
- Backfilling a `Payment` row for historical authenticated orders, which have none.
- Any change to how authenticated checkout resolves its customer or address.

## Decisions

### Extend `placeOrder` rather than adding a parallel guest path

`placeOrder` is ~230 lines carrying the store's entire pricing and stock-safety logic: multi-warehouse deduction, coupon revalidation, tax on post-discount subtotal, free-shipping threshold, expected-total mismatch, idempotency replay, order-number collision retry. A separate `placeGuestOrder` would either duplicate all of it or refactor it out under time pressure — and any future pricing fix would then need applying twice, with the guest path (the campaign path, the one carrying ad spend) being the one silently missed.

Instead, change the signature from `placeOrder(userId, payload)` to `placeOrder(actor, payload)`, where `actor` is a discriminated union:

```
{ kind: "user"; userId: string } | { kind: "guest"; guestToken?: string; ip: string }
```

A `resolveCheckoutContext(actor, payload)` helper returns `{ customer, cart, shippingAddressId }` and is the only branching point. Everything downstream is untouched.

**Alternative rejected:** keeping `userId?: string` optional. It makes "no user and no guest token" representable and pushes a runtime guard into the middle of checkout. The union makes the invalid state unconstructible.

### Phone as the guest merge key, with a unique constraint

Per the user's decision. In this market a phone number is the de facto customer identity, and it is already collected for COD delivery — no extra checkout friction. The alternative (a new `Customer` per guest order) is trivially simpler but destroys repeat-customer analytics and order history, which is much of the value of running campaigns at all.

This requires `@unique` on `Customer.phone`. Two consequences:

- **Existing duplicates must be reconciled first.** See Migration Plan.
- **Phone is unverified, so it is a claim, not proof.** Anyone can type someone else's number. This is why guest lookup requires order number *and* phone (guessing both is materially harder than guessing one), and why a guest resolving onto a registered customer's record gets no session, no saved addresses, and no order history — only the ability to place an order that attaches to it. That asymmetry is deliberate: attaching is low-harm and preserves the merge; reading is a disclosure and stays gated.

### Reuse the existing guest cart, and support a direct-items payload

Checkout resolves the guest's cart by `guestToken` cookie — the same row the cart routes already write to, so a guest who added items then checks out finds their cart intact.

The campaign flow, though, is often a single product page with a buy button and no cart interaction. Forcing that through the cart costs an extra round trip and creates a cart row per ad click. So `placeOrder` also accepts `items` in the payload; when present it uses them instead of the cart, and skips the cart-clearing step. Prices and stock are still resolved server-side from the database — a client-supplied price is never trusted.

**Note on the earlier discussion:** the user set this question aside as a Facebook-side concern. It is not — Facebook's button is just a link, but what the landing page can do on arrival depends entirely on whether this endpoint accepts items directly. Supporting both is a small addition here and avoids a re-plan when the landing page is built.

### `GUEST_TOKEN_COOKIE` moves to a shared constant

It is currently a private const in `cart.controller.ts`. Order needs the identical name and options — a mismatch means checkout silently reads a different cookie than the cart wrote, and every guest sees an empty cart at the final step. Moving it to `cart.constant.ts` (matching the existing `coupon.constant.ts` pattern) makes that failure impossible rather than merely unlikely.

### Rate limiting in the database, not in memory

The spec requires two limits: concurrent unfulfilled COD orders per phone, and guest orders per IP per window.

The phone limit is a `count` against `Order` filtered by customer, guest flag, and non-terminal status — the data is already there, needs no new store, and stays correct across restarts and multiple instances.

The IP limit needs request history. Rather than adding Redis or an in-process counter (wrong under multi-instance deployment, and lost on restart), record the IP on the `Order` row and count recent guest orders from it. One indexed query, no new infrastructure, correct across instances.

**Trade-off accepted:** this only counts *successful* orders, so it does not throttle a flood of failing attempts. That is a DoS concern, better handled at the reverse proxy, and out of scope here.

Both checks run before the checkout transaction opens, so a rejected order never touches stock.

**Alternative rejected:** `express-rate-limit`. A new dependency, memory-backed by default (so wrong under multi-instance), and it keys on IP only — it cannot express the per-phone pending-order cap, which is the limit that actually matters for COD.

### Guest orders create a COD `Payment` row; authenticated orders keep their current behavior

`placeOrder` creates no `Payment` today. Guest orders need one — a COD order with no payment record is invisible to reconciliation. Creating one for guest orders only is inconsistent, but consistency here would mean changing authenticated checkout's behavior, which this change explicitly does not do. Flagged for a follow-up rather than silently widened.

The `Payment` row is created inside the existing checkout transaction, so an order can never commit without it.

### `Order.isGuestOrder` and `Order.guestIp`

Deriving "is this a guest order" from `customer.userId == null` is wrong the moment a guest checks out against a registered customer's phone — that order would look authenticated. An explicit flag records what actually happened at checkout time. `guestIp` backs the IP limit above.

## Risks / Trade-offs

**Unverified phone lets a guest attach an order to a stranger's customer record** → Attaching is permitted (it preserves the merge and cannot leak data); reading is not. Guest lookup requires order number plus phone. No session, saved address, or order history is exposed. OTP verification would close this properly and is the natural follow-up.

**The unique constraint on `Customer.phone` fails to apply if duplicates exist** → Reconciled in a pre-migration step with an explicit report, not an automatic merge. See Migration Plan.

**COD abuse still possible within the limits** → The caps bound the damage but do not eliminate it; an attacker with many phone numbers and addresses can still place junk orders. Full mitigation needs OTP. Cap values should start conservative and be tuned against real order data.

**Guest checkout bypasses per-customer coupon usage limits** → `validateCouponForCart` receives a `customerId`, so once a guest resolves to a customer the check applies normally. But a guest using a fresh phone each time gets a fresh customer and a fresh allowance. Worth verifying against `CouponService`'s per-customer limit logic during implementation; if campaign coupons are single-use per customer, this is a real hole.

**Two callers of `placeOrder` after the signature change** → The controller is the only caller today, so the blast radius is one file. TypeScript's exhaustiveness on the discriminated union catches any missed branch at compile time.

## Migration Plan

Two schema changes, in this order:

1. **Reconcile duplicate phone numbers.** Query for phone values held by more than one `Customer`. If any exist, do not merge automatically — an automatic merge would silently combine two people's order histories if the data holds a shared number (a family phone, a reused shop number). Report them and decide case by case. Also normalize phone format before applying the constraint, or `01712345678` and `+8801712345678` will be treated as different customers and the merge key quietly fails on a large share of real traffic. Decide the canonical format and normalize on write.

2. **Apply the schema changes.** `@unique` on `Customer.phone`; add `Order.isGuestOrder` (boolean, default false) and `Order.guestIp` (nullable string, indexed with `createdAt` for the rate-limit query). Existing orders correctly default to `isGuestOrder: false`.

**Rollback.** Both schema changes are additive apart from the unique constraint, which can be dropped without data loss. Reverting the route from `optionalAuth` back to `checkAuth` disables guest checkout immediately without a schema change — that is the fast rollback if abuse gets out of hand. Guest orders already placed remain valid and readable.

## Open Questions

- **Cap values.** Starting points: 3 concurrent unfulfilled COD orders per phone, 10 guest orders per IP per hour. Both should be tunable without a deploy — `StoreSetting` is the natural home given it already holds `defaultTaxRatePercent` and `freeShippingThreshold`. Real numbers need real traffic; these are safe to start conservative and loosen.
- **Which order statuses count as "unfulfilled"** for the per-phone cap. `PENDING` and `CONFIRMED` mirror `CUSTOMER_CANCELLABLE_STATUSES` and are the likely answer, but whether `PROCESSING` and `SHIPPED` should count depends on how the fulfillment team actually works. Does not affect the specs or task breakdown.
