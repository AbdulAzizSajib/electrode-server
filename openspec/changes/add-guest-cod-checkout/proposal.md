## Why

Paid social campaigns send buyers straight from an ad to a product page with intent to buy immediately. Checkout currently requires a session — `POST /order` sits behind `checkAuth(...ALL_ROLES)` and `placeOrder` resolves its customer via `getOrCreateCustomerByUserId(userId)` — so that traffic hits a registration wall at the exact moment intent is highest, and the campaign spend converts into abandoned carts instead of orders.

The storefront half of this is already built: `Cart` carries a `guestToken`, `resolveCart` mints one for an anonymous visitor, and `mergeGuestCartIntoCustomerCart` folds a guest cart into a customer's on login. A guest can fill a cart today and then cannot buy it. This change closes that last step.

## What Changes

- **Checkout accepts guests.** `POST /order` moves from `checkAuth(...ALL_ROLES)` to `optionalAuth`, matching how the cart routes already work. Authenticated checkout is unchanged — same endpoint, same behavior, same response shape.
- **Guest checkout requires contact + address in the request body.** A guest has nothing saved, so `fullName`, `phone`, and shipping address fields travel in the payload. Authenticated customers keep using `shippingAddressId` as they do today.
- **Guests are identified by phone.** A guest order resolves to an existing `Customer` with that phone, or creates one. `Customer.userId` is already nullable, so a customer row without a user account is a shape the schema already permits. Repeat buyers from repeat campaigns accumulate onto one customer record with one order history.
- **Guest carts become checkout-able.** `placeOrder` reads the cart by `guestToken` when there is no session, using the same `Cart` row the cart routes have been writing to all along.
- **COD only for guests.** A guest order creates a `Payment` row with `method: COD` and `status: PENDING`. Guests may not select an online payment method; `PaymentMethod.COD` already exists in the enum.
- **Guest orders are rate-limited.** No session and no payment step means nothing currently stops a script — or a bored visitor — from placing unlimited COD orders that deduct real stock. A cap on pending COD orders per phone, and per IP over a time window, is part of this change rather than a follow-up.
- **Guest order lookup by order number + phone.** Guests have no session to authenticate a later `GET /order/:id`, so tracking an order needs a scoped lookup that does not expose orders to anyone holding an id.

## Capabilities

### New Capabilities
<!-- None. Guest checkout extends the existing checkout capability rather than introducing a separate one; splitting it would fragment requirements that must be read together. -->

### Modified Capabilities
- `api/checkout`: Checkout no longer requires an authenticated session. Adds requirements for guest identification by phone, payload-supplied shipping address, COD-only payment for guest orders, abuse limits on guest ordering, and phone-scoped guest order lookup. Amends the existing "A customer can only see their own orders" requirement, which today assumes every order has a logged-in owner.

## Impact

**Schema (migration required)**
- `Customer.phone` gains a unique constraint — today it carries a non-unique `@@index`. This is what makes phone a merge key. Existing duplicate phone values must be reconciled before the constraint applies.
- `Order` gains a flag distinguishing guest-placed orders, so staff tooling and abuse limits can identify them without inferring from `customer.userId`.

**Code**
- `src/app/module/order/order.route.ts` — `checkAuth` → `optionalAuth` on `POST /`; new guest order lookup route.
- `src/app/module/order/order.service.ts` — `placeOrder` splits customer resolution and cart resolution across the session/guest paths; creates the COD `Payment` row; enforces abuse limits.
- `src/app/module/order/order.controller.ts` — reads `req.user` optionally and the guest cart cookie; today it reads `req.user.userId` unconditionally and would throw for a guest.
- `src/app/module/order/order.validation.ts` — conditional payload validation: guest checkout requires contact and address fields, authenticated checkout does not.
- `src/app/module/customer/customer.service.ts` — new phone-based get-or-create alongside `getOrCreateCustomerByUserId`.

**Behavior already correct, deliberately untouched**
- Stock validation and deduction, coupon redemption, tax and free-shipping calculation, idempotency replay, and order-number retry all operate on a resolved `customer.id` and work unchanged once a guest has one.

**Out of scope**
- OTP/phone verification. It would cut fake COD orders materially but adds a checkout step and an SMS gateway dependency; the rate limits here are the cheaper first line of defense.
- Online payment for guests, and converting a guest customer into a registered user on later signup.
