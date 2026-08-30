## 1. Data reconciliation and schema

- [x] 1.1 Write a script that reports `Customer` rows sharing a phone number, and rows whose phone differs only by format (leading `0` vs `+880`). Run it and record the result — do not merge automatically; a shared number may be two real people.
      → `scripts/report-duplicate-customer-phones.ts`. Run result: 2 customers hold a phone, **no collisions** (exact or format-variant), no unnormalizable values. Both values will be rewritten to E.164 by the backfill. The unique constraint applies cleanly.
- [x] 1.2 Decide the canonical phone format and add a normalization helper applied on every write and lookup. Without this, `01712345678` and `+8801712345678` resolve to different customers and the merge key fails on much of real traffic.
      → E.164 (`+8801XXXXXXXXX`), chosen because it is unambiguous and is what SMS gateways expect if OTP is added later. Helper: `src/app/utils/phone.ts` (`normalizePhone`, `isValidPhone`).
- [x] 1.3 Reconcile the duplicates found in 1.1 (case by case, using the decision from 1.2).
      → Nothing to reconcile; 1.1 found zero collisions.
- [x] 1.4 Add `@unique` to `Customer.phone` in `prisma/schema/customer.prisma`, keeping the existing `@@index`.
- [x] 1.5 Add `isGuestOrder Boolean @default(false)` and `guestIp String?` to `prisma/schema/Order.prisma`, with `@@index([guestIp, createdAt])` for the rate-limit query.
- [x] 1.6 Add guest-checkout limit fields to `StoreSetting`: max concurrent unfulfilled COD orders per phone (default 3) and max guest orders per IP per hour (default 10), so caps are tunable without a deploy.
- [x] 1.7 Generate and apply the migration; confirm existing orders default to `isGuestOrder: false`.
      → Ran `scripts/normalize-customer-phones.ts` first (2 values rewritten to E.164), since the unique constraint must land on already-canonical data. Migration `20260830120000_add_guest_cod_checkout` written by hand — `prisma migrate dev` refuses to run non-interactively — and applied with `migrate deploy`. `migrate status` reports no drift. Verified: all 13 existing orders have `isGuestOrder: false` / `guestIp: null`, and StoreSetting seeded at 3 / 10.

## 2. Shared constants and customer resolution

- [x] 2.1 Move `GUEST_TOKEN_COOKIE` and `GUEST_TOKEN_COOKIE_OPTIONS` out of `cart.controller.ts` into a new `cart.constant.ts`, mirroring `coupon.constant.ts`. Update `cart.controller.ts` to import them. A divergent cookie name between cart and order means every guest sees an empty cart at checkout.
- [x] 2.2 Add `getOrCreateCustomerByPhone(phone, fullName)` to `customer.service.ts`, alongside the existing `getOrCreateCustomerByUserId`. Normalize the phone via 1.2, split `fullName` into first/last the way `getOrCreateCustomerByUserId` splits `user.name`, and create with `userId: undefined`.
      → Also handles a P2002 race (two checkouts for the same new phone) by reading back the winner's row.
      → **Scope beyond the task text:** `getOrCreateCustomerByUserId` wrote `user.contactNumber` raw. With `phone` now unique that is a live bug — it bypasses the merge, and throws P2002 outright if a guest already holds the normalized form, failing that user's first checkout. Now normalized, and falls back to leaving `phone` unset when the number already belongs to another customer rather than failing account creation.
- [ ] 2.3 Add a unit test: two calls with the same phone in different formats return the same `Customer`.
      → **BLOCKED — needs a decision.** No test runner or test file exists anywhere in the repo; `pnpm test` is a stub that exits 1. Writing this test means introducing test infrastructure (vitest + config), which this change never scoped.
      → Behavior was verified directly instead: 20/20 normalization cases pass and all 5 format variants of one number converge to a single E.164 value. That verification **found and fixed a real bug** — `startsWith("880")` was tested before `startsWith("00880")`, so `00880…` numbers were silently mis-normalized into a different number. Fixed in `src/app/utils/phone.ts` by testing the longest prefix first.

## 3. Checkout actor and context resolution

- [x] 3.1 Define the actor union in `order.interface.ts`: `{ kind: "user"; userId: string } | { kind: "guest"; guestToken?: string; ip: string }`.
- [x] 3.2 Extend `ICreateOrderPayload` with the guest fields — `fullName`, `phone`, a full shipping address object, an optional `items` array, and `paymentMethod`.
- [x] 3.3 Write `resolveCheckoutContext(actor, payload)` in `order.service.ts` returning `{ customer, cart, shippingAddressId }`. User branch: existing `getOrCreateCustomerByUserId` + cart-by-`customerId` + the existing `shippingAddressId` ownership check. Guest branch: `getOrCreateCustomerByPhone` + cart-by-`guestToken` + create a `CustomerAddress` from the payload.
      → Returns `{ customer, shippingAddressId }`; cart loading stayed in `placeOrder` because it must be issued in the same `Promise.all` as the idempotency replay check to preserve that concurrency.
- [x] 3.4 Change `placeOrder(userId, payload)` to `placeOrder(actor, payload)` and route its first ~40 lines through `resolveCheckoutContext`. Everything from the stock-availability query onward operates on `customer.id` and must remain unchanged.
      → Downstream now reads a `lines` array rather than `cart.items` directly (same data for a cart checkout), so both line sources feed one pricing path. Also fixed: the order was written with `payload.shippingAddressId`, which is null for a guest — now uses the resolved id.
- [x] 3.5 Support payload-supplied `items`: when present, build the order lines from them (resolving name, SKU, and price server-side from the database — never from the client) instead of from the cart, and skip the cart-clearing step. When absent, use the cart exactly as today.
      → `loadPayloadLines` merges duplicate lines for the same product/variant first, so ordering one item twice in a payload checks stock against the combined quantity rather than each half separately.

## 4. Guest-specific rules

- [x] 4.1 Enforce COD-only for guests: reject a guest request specifying any `paymentMethod` other than `COD` with 400.
      → Defence in depth: the Zod schema makes `COD` the only spellable value, and `resolveCheckoutContext` rejects anything else for a guest.
- [x] 4.2 Create the `Payment` row (`method: COD`, `status: PENDING`, `amount: totalAmount`) for guest orders inside the existing checkout transaction, so an order cannot commit without it.
- [x] 4.3 Set `isGuestOrder: true` and `guestIp` on guest orders.
- [x] 4.4 Implement the per-phone cap: count the resolved customer's guest orders in unfulfilled statuses (start with `PENDING` and `CONFIRMED`, matching `CUSTOMER_CANCELLABLE_STATUSES`) against the 1.6 setting; reject with 429.
- [x] 4.5 Implement the per-IP limit: count guest orders with the same `guestIp` inside the rolling window against the 1.6 setting; reject with 429.
- [x] 4.6 Confirm both checks run before `prisma.$transaction` opens, so a rejected order never deducts stock.
      → `enforceGuestOrderLimits` is called inside `resolveCheckoutContext`, which runs before the cart load, the stock query and the transaction. Both counts issue concurrently.

## 5. Validation

- [x] 5.1 Make `createOrderZodSchema` conditional: guest requests require `fullName`, `phone`, and the full address; authenticated requests keep accepting `shippingAddressId`. Since Zod alone cannot see the session, validate shape here and enforce the guest/auth distinction in the service or via a refinement fed by the resolved actor.
      → Zod validates shape (every field optional but well-formed if present); `resolveCheckoutContext` enforces the guest requirement, where the actor is known.
- [x] 5.2 Reject a guest request that supplies `shippingAddressId` instead of full address fields with 400 — a guest cannot prove ownership of a stored address.
- [x] 5.3 Validate phone format against the canonical format from 1.2.
      → `isValidPhone` refinement on both `createOrderZodSchema` and `guestOrderLookupZodSchema`.

## 6. Routes and controller

- [x] 6.1 Change `POST /` in `order.route.ts` from `checkAuth(...ALL_ROLES)` to `optionalAuth`. Leave every other order route on `checkAuth`.
- [x] 6.2 Update `placeOrder` in `order.controller.ts` to build the actor from `req.user` when present, otherwise from the guest token cookie and `req.ip`. It currently reads `req.user.userId` unconditionally and would throw for a guest.
- [x] 6.3 Add the guest order lookup route (order number + phone) with its controller and service function: match on both, return 404 when the phone does not match so the response reveals nothing about whether the order number exists.
      → `POST /order/track`, not GET: the phone is half the credential and a query string lands in access logs, browser history and referrer headers. Declared before `/:id` so that route cannot swallow it. One 404 covers "no such order", "wrong phone" and "not a guest order" alike.
- [x] 6.4 Verify `getOrders`, `getOrderById`, `cancelOrder`, and `updateOrderStatus` still reject session-less requests with 401.
      → All four still use `checkAuth`, which throws 401 when no session cookie is present. Only `POST /` and `POST /track` are session-optional.
- [x] 6.5 Confirm `req.ip` reflects the real client address behind the deployment's proxy — check that Express `trust proxy` is set correctly, or the per-IP limit will see one shared address and throttle every guest at once.
      → **It was not set at all.** This deploys behind a proxy (Vercel), so `req.ip` would have been the proxy's address and the per-IP limit would have throttled all guests collectively after 10 orders/hour. Added `app.set("trust proxy", 1)` in `app.ts` — 1 hop, not `true`, since trusting the whole chain lets a client forge `X-Forwarded-For` and choose its own apparent IP, defeating the limit entirely.

## 7. Verification

All verification below was run live against the dev server and the Neon database, not reasoned about.

- [x] 7.1 Guest checkout end to end: add to cart as a guest, check out with contact and address, confirm the order, its COD `Payment`, the `CustomerAddress`, and `isGuestOrder: true` all exist.
      → `ORD-20260830-DPHAQB`, total 239.97 (3 × 79.99). COD/PENDING payment row present, address persisted, `isGuestOrder: true`. Cart emptied but the `Cart` row kept for reuse; stock deducted with a matching `SALE` movement.
- [x] 7.2 Direct-items guest checkout with no prior cart interaction.
      → `ORD-20260830-CQ2HYK`. No session, no cart, no cookie — order created from payload items alone, price resolved server-side.
- [x] 7.3 Repeat guest order with the same phone in a different format attaches to the same `Customer`, and both orders appear in that customer's history.
      → `01712345678` then `+880 1712-345678` both resolved to customer `cmtfu98g80000x0kgbvumls3i` (`userId: null`), 2 orders in history, 1 customer row holding either format.
- [x] 7.4 Authenticated checkout regression: place an order with a saved `shippingAddressId` and confirm the response is byte-identical in shape to before this change.
      → `ORD-20260830-N9YQTY` via a real registered + logged-in user: `isGuestOrder: false`, `guestIp: null`, `payments: []` (auth behavior deliberately unchanged), saved address honored. Only shape difference is the two new columns, which is the intended additive change. Also confirmed the guest caps do **not** apply to authenticated users (5 orders, no 429).
- [x] 7.5 Confirm coupon, tax, free-shipping threshold, expected-total mismatch, and idempotency replay all behave the same on the guest path as the authenticated one.
      → With tax 10% and free-ship threshold 200 temporarily set: subtotal 239.97, coupon −24, shipping 0 (threshold met, despite a paid method), tax 21.60 on the **post-discount** subtotal, total 237.57 — matches hand calculation. `expectedTotal` mismatch → 409; correct → 201. Idempotency replay → 200 with the same order number and no duplicate; malformed key → 400. Coupon `usageCount` incremented to 1 only on commit. Settings restored and the test coupon deleted afterwards.
- [x] 7.6 Both rate limits reject with 429 and leave stock untouched.
      → Per-phone: 3rd order succeeded at the cap boundary, 4th → 429. Stock stayed at 73 (not 72) and no order row was created. Per-IP: orders 8–10 succeeded, 11th → 429, exactly 10 orders recorded. No orphan `CustomerAddress` from either rejection.
      → Noted: a rejected request does leave an empty `Customer` row, since the customer must be resolved before the per-phone cap can be counted. No order, address, or stock effect — recorded rather than restructured.
- [x] 7.7 Guest lookup returns the order for the correct phone and 404 for a mismatched one.
      → Correct phone (in a different format than stored) → 200. Wrong phone and nonexistent order number → byte-identical 404s, so the response cannot be used to probe which order numbers exist.
- [x] 7.8 Check `CouponService`'s per-customer usage limit against guest checkout — a guest using a fresh phone each time gets a fresh customer and a fresh allowance. If campaign coupons are meant to be single-use per customer, this is a real hole; report it rather than fixing it here.
      → **The limit does apply to guest checkout**, contrary to what the code's comment claimed: the guest is resolved to a `Customer` before validation runs, so a `perCustomerLimit: 1` coupon reused on the same phone was correctly rejected ("You have already used this coupon the maximum number of times"). Stale comment in `coupon.service.ts` corrected.
      → **Residual gap confirmed as predicted:** a guest supplying a *different* phone each time gets a different customer and a fresh allowance. Inherent to unverified phone identity — closing it needs OTP, not a change here. Reported, not fixed.
