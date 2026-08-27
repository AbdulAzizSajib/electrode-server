## Why

Placing an order currently reports failure while succeeding. The storefront proxies `POST /orders` through its own Next.js route (`electrode-nextjs/src/lib/api-proxy.ts`), which aborts the upstream fetch after a fixed `TIMEOUT_MS = 10_000` and returns a fabricated `503 "Unable to reach the server. Please try again."`. Aborting that fetch does **not** abort the Express handler: `OrderService.placeOrder` keeps running, commits the order, deducts stock, and empties the cart. The shopper sees a failure, retries, and gets `400 "Your cart is empty"` — while RTK Query still renders the old cart, because `orderApi` only invalidates the `Cart` tag on success. The order is in the database the whole time.

Two things make this reachable rather than theoretical. First, `placeOrder` issues roughly 40 sequential database roundtrips for a small cart — a per-item stock aggregate inside a loop, up to five sequential order-number probes, per-item stock deduction inside the transaction, and a per-item low-stock notification *after* it — so 10s is not a generous budget on a cold or remote Postgres. Second, there is **no idempotency at all**: nothing distinguishes a retry from a genuine second purchase, so a timeout retry, a refresh-and-resubmit, or a double-click creates a duplicate order and deducts stock twice. That is the most serious defect in this change.

The same "every mutation costs a full server roundtrip before the UI moves" pattern also makes the cart feel slow, which is what surfaced the bug: `updateItemQuantity` and `removeItem` have no optimistic update, the stepper buttons disable while in flight, and `invalidatesTags` forces a second full `GET /cart` even though the mutation response already carries the whole cart.

## What Changes

**Checkout correctness (priority)**

- Order placement becomes **idempotent**. The client generates a UUID per checkout attempt and sends it as an `Idempotency-Key` header; the server persists it on `Order` behind a unique constraint. A replay of the same key returns the *original* order with `200` instead of creating a second one, so stock is deducted exactly once. **BREAKING** for direct API consumers only in that the header is required to get replay protection — a request without one keeps today's behavior rather than being rejected.
- `placeOrder` collapses its sequential query chain: cart-line stock availability is fetched in a single grouped aggregate instead of one query per item, the order number is generated without a read-probe loop, and low-stock notification work moves off the request path so it no longer delays the response after the transaction has already committed.
- The proxy stops lying about timeouts. `POST /orders` gets its own longer timeout (cheap reads keep the current one), and an actual timeout now returns `504` with copy that states the outcome is **unknown** — "your order may have gone through, check your orders before retrying" — rather than claiming the server was unreachable.
- The storefront invalidates the cart on a timed-out order too, so the UI refetches the truth instead of rendering a cart the server has already emptied.

**Cart latency**

- `updateItemQuantity` and `removeItem` gain optimistic updates, and the quantity stepper stops disabling itself on every click, so stepping a quantity is immediate instead of waiting a roundtrip.
- Cart mutations stop triggering a redundant refetch: the mutation response already contains the full cart, so it seeds the `getCart` cache directly instead of invalidating and re-fetching. Two roundtrips per click become one.
- The quantity stepper debounces rapid clicks into a single request carrying the final quantity.
- Server-side, cart mutations stop resolving the heavy `CART_INCLUDE` when they only need `cart.id`, and independent lookups (cart resolution vs. product/variant validation) run concurrently rather than in sequence.

**Explicitly unchanged**: the cart stays server-owned. Guest-cart merge on login, cross-device carts, and server-side price/stock revalidation all depend on that, and this change keeps it.

## Capabilities

### New Capabilities

None. Both affected capabilities already exist.

### Modified Capabilities

- `api/checkout`: adds a requirement that order placement is idempotent under retry (replaying an idempotency key returns the original order and does not re-deduct stock), and a requirement that a checkout whose outcome is indeterminate to the client is never reported as a definite failure.
- `api/cart-wishlist`: adds a requirement that a cart mutation's response is itself the authoritative post-mutation cart, so a client needs exactly one roundtrip per change.

## Impact

- **Affected code (electrode-server)**: `prisma/schema/**` — new nullable unique `Order.idempotencyKey` plus a migration; `src/app/module/order/order.service.ts` — idempotent placement, batched stock aggregate, order-number generation, deferred notifications; `order.controller.ts` / `order.validation.ts` — reading and validating the header; `src/app/module/cart/cart.service.ts` — light cart resolution for mutations, concurrent lookups; `src/app/module/stock/stock.service.ts` — low-stock notification moved off the request path.
- **Affected code (electrode-nextjs)**: `src/lib/api-proxy.ts` — per-route timeout and honest `504`; `src/app/api/orders/route.ts` — opt into the longer timeout and forward the header; `src/store/orderApi.ts` — generate the key, invalidate `Cart` on timeout; `src/store/cartApi.ts` — optimistic updates and response-seeded cache; `src/components/cart/CartLineControls.tsx` — debounce, drop the disable-while-busy behavior; `src/components/checkout/CheckoutForm.tsx` — surface the indeterminate-outcome message.
- **Cross-repo**: this change spans two repositories. OpenSpec's planning home is `electrode-server`, but roughly half the work lands in the sibling `electrode-nextjs` checkout. `tasks.md` labels every task with its repo.
- **Migration**: adding `Order.idempotencyKey` as nullable with a unique index is backward compatible — existing orders keep `NULL`, and Postgres treats NULLs as distinct in a unique index, so no backfill is required.
- **Not covered**: payment-gateway integration (a real gateway would need its own idempotency handshake, deferred with the rest of Tier 3), and any change to how the cart is stored or owned.
