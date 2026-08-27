## Context

See proposal.md — Why. The mechanics worth restating here, because the design turns on them:

The storefront never talks to Express directly. `guestToken`, `appliedCoupon`, and the auth cookies are httpOnly on the API's own domain, so the browser cannot carry them cross-site; every `/api/*` call goes through a Next.js route handler that forwards cookies and relays the response (`electrode-nextjs/src/lib/api-proxy.ts`). That proxy applies `AbortSignal.timeout(10_000)` to its upstream fetch. **Aborting a fetch on the Next side does not abort the Express handler** — Node has already written the request; the handler runs to completion regardless. So a timeout produces a client that believes the request failed and a server that committed it. Every design decision below follows from that asymmetry: the client cannot be made to know the outcome, so the system must be safe when it guesses wrong.

`prisma/schema/Order.prisma` has one migration (`20260821170224_init`) and no `idempotencyKey` field. There is no test runner configured (`package.json` `test` is a stub), so verification in tasks.md is manual and DB-observable rather than automated.

Two constraints bound the work:

- **Cross-repo.** OpenSpec's planning home is `electrode-server`; roughly half the implementation is in the sibling `electrode-nextjs` checkout. Nothing enforces that both land together, so the design must degrade safely when only one side is deployed.
- **Server-owned cart stays.** Guest-cart merge on login and server-side price/stock revalidation depend on it. The latency work is about roundtrip *count* and perceived latency, not about relocating cart state to the client.

## Goals / Non-Goals

**Goals:**

- A retried checkout can never produce a second order or a second stock deduction, whatever the client does.
- The two sides can deploy independently, in either order, without a window where checkout is broken.
- Checkout's response time drops enough that a timeout becomes exceptional rather than routine — while accepting that "exceptional" is not "impossible", which is why idempotency carries the correctness weight.
- A cart quantity change costs one server roundtrip and does not block the interface.

**Non-Goals:**

- Distributed locking or a queue for checkout. A unique constraint is sufficient at this scale and has no new infrastructure.
- A general-purpose idempotency layer across every endpoint. Only order placement is destructive-on-replay today; generalizing it now would be speculative.
- Gateway-level payment idempotency — a real gateway brings its own handshake, and Tier 3 stays deferred.
- Moving cart state to the client, or trusting client-computed money anywhere.

## Decisions

### D1: Idempotency via a unique column on `Order`, not a separate table or a cache

`Order` gets `idempotencyKey String? @unique`. The insert is the concurrency control: two concurrent replays race to insert, the database lets exactly one win, and the loser catches Prisma's `P2002` unique-violation and re-reads the winner's order.

*Why not a dedicated `IdempotencyRecord` table:* it would need its own lifecycle (when to expire, what to store for in-flight vs. completed) and a second write inside the transaction, to protect exactly one endpoint. The order row already *is* the record of "this key produced this outcome".

*Why not Redis or in-memory:* in-memory dies with the process, which is precisely the failure being defended against. Redis is real infrastructure for a constraint Postgres already enforces.

*Why nullable:* it makes the migration backward-compatible with zero backfill, and it is what lets the two repos deploy in either order (D4). Postgres treats NULLs as distinct in a unique index, so unlimited existing and key-less orders coexist — the same NULL-distinctness property that `cart.service.ts` already works around for `variantId`, here working in our favor.

*Scoping:* the spec requires one customer's key cannot collide with another's. A client-generated UUIDv4 makes accidental collision negligible, but a *malicious* key guess would otherwise return another customer's order. Two options — a compound `@@unique([customerId, idempotencyKey])`, or a global unique plus an ownership check on the replay path. Take the **global unique plus ownership check**: on `P2002`, re-read the order by key and confirm `customerId` matches the requester; if it does not, treat it as a fresh request rather than disclosing anything. Compound-unique would also work but makes the replay lookup a two-column query for no added safety once the ownership check exists.

*Retention:* keys live as long as their order. No expiry job — an order is already the retention unit, and a key that outlives its usefulness costs one nullable column.

### D2: Cheap wins on latency, no restructuring of the transaction

The ~40 roundtrips come from four places. Fix them in descending order of payoff-to-risk:

1. **Per-item stock aggregate in a loop** (`order.service.ts:157`) → one `groupBy` over all cart lines, then check each line against the result in memory. N queries → 1.
2. **Per-item `notifyIfLowStock` after the transaction** (`:273`) → this runs *after* the order has committed and cannot change its outcome, yet the client waits for it. Each iteration does a product lookup, a stock aggregate, a user `findMany`, and a `createMany`. Move it off the request path: fire it without awaiting, with its own `.catch()` so an unhandled rejection cannot take the process down. `NotificationService` already swallows its own errors, so this only changes *when* it runs, not whether failures are tolerated.
3. **Order-number probe loop** (`:39-51`) → up to 5 sequential reads to avoid a collision on a random 6-char suffix. Drop the probe entirely; rely on `orderNumber`'s existing `@unique` and, on `P2002`, regenerate and retry the insert. Same protection, zero reads in the common case.
4. **Per-item stock deduction inside the transaction** (`:251-260`) → **leave as is.** It is genuinely sequential (each item's deduction depends on reading that item's warehouse rows), it is the part that must stay transactional, and the multi-warehouse split logic is subtle and correct. The first three items remove far more latency for far less risk.

*Explicitly not done:* raising the Prisma transaction timeout, or splitting the transaction. The transaction is not the slow part; the chatter around it is.

### D3: Per-route proxy timeout, and a `504` that admits uncertainty

`proxyRequest` takes an optional `timeoutMs`. Cheap reads keep 10s; `POST /orders` gets 30s. The timeout branch currently returns `503 "Unable to reach the server. Please try again."` — two lies in one string: the server was reached, and retrying is exactly the wrong advice. It becomes `504` with copy stating the outcome is unknown and directing the shopper to check their orders first.

*Why not just raise the timeout:* a longer timeout narrows the window but does not close it, and leaves the misleading copy and the stale cart in place. Timeout tuning is mitigation; idempotency is the fix.

*Distinguishing timeout from genuine unreachability:* the current `catch` conflates `AbortError` with connection refused. Split them — a real connection failure keeps `503` and "try again" (safe, nothing was sent); only the abort path gets the `504` uncertainty copy.

### D4: Both repos degrade safely when deployed alone

Neither side may assume the other shipped:

- **Server first, storefront old:** requests arrive without the header. Column stays NULL, existing behavior preserved — this is why nullable matters.
- **Storefront first, server old:** the header is sent and ignored by an older server. No worse than today. The longer timeout and honest error copy are pure client-side improvements that stand alone.

So the deployment order is unconstrained. Server-first is still preferable, because that is the order in which the protection actually starts working.

### D5: Storefront treats a timeout as "cart state unknown"

`orderApi` currently invalidates `Cart` only on success, reasoning that a failed order leaves the cart untouched. That reasoning holds for a `400`/`409` — the server rejected before committing — but not for a timeout, where the cart may well have been emptied. Invalidate `Cart` on the timeout path too. Definite rejections keep today's behavior, since preserving the cart is what lets a shopper fix a quantity and retry.

The idempotency key is generated per *checkout attempt* and held in component state — regenerated when the shopper meaningfully changes the order (address, shipping method, cart contents), not on every render, and deliberately **not** regenerated when they press the button again after a failure. That is the whole point: the same key must ride the retry.

### D6: Cart mutations seed the cache instead of invalidating it

Every cart mutation already returns the full cart (`cart.controller.ts` sends `reloadCart`'s result), and the spec now makes that contract explicit. But `invalidatesTags: ["Cart"]` throws that response away and issues a second `GET /cart`. Replace with `onQueryStarted` → `updateQueryData` seeded from the mutation's own response, running the same `toCartSummary` transform the query uses. Two roundtrips per click become one.

*One asymmetry to respect:* `GET /cart` re-validates the applied coupon and the controller clears a now-invalid coupon cookie; the mutation path does not. Since the mutation response carries `discount` too, seeding stays correct for the displayed cart. Where it could drift is the *cookie*, not the rendered state — and the next real cart read reconciles it. Acceptable; noted so it is not rediscovered as a bug.

*Optimistic update + debounce:* the stepper updates local quantity immediately and debounces ~400ms before sending the final value, so five rapid clicks send one request. Drop `disabled={busy}` from the stepper — that is the visible freeze. Keep it on remove, where the row disappears and a double-fire is genuinely confusing. On rejection, `patch.undo()` restores the last confirmed quantity and the error surfaces.

*Trade-off accepted:* dropping `disabled` removes the current double-submit guard. Debounce-then-send replaces it — in-flight requests for a line are superseded by the latest value rather than queued.

### D7: Cart mutations resolve a light cart

`resolveCart` returns the full `CART_INCLUDE` (items → product → images, variant) on every call, but `addItem`/`updateItemQuantity`/`removeItem` use only `cart.id` from it before calling `reloadCart` anyway — the heavy include is fetched and discarded. Add a light variant returning just the id (and guest-token side effects), leaving `getCart`'s path unchanged. In `addItem`, cart resolution and the product/variant validation lookups are independent, so run them concurrently with `Promise.all`.

## Risks / Trade-offs

- **A key is reused across genuinely different orders** (client bug regenerating too rarely) → the second, legitimately different order silently returns the first order's data. Mitigated by regenerating on any material change to the order in D5, and by the ownership check surfacing nothing cross-customer. Worth a log line when a replay is served whose current cart differs from the stored order's contents.
- **`P2002` catch is too broad** → `Order` has two unique columns now (`orderNumber`, `idempotencyKey`), and D2's order-number retry also keys off `P2002`. Catching it generically would make a collision on one look like a replay of the other. Inspect `error.meta.target` and branch explicitly; do not treat "some unique violation" as "this was a replay".
- **Fire-and-forget notifications lose their error path** → a low-stock alert can now fail with nobody watching. It already swallowed errors internally, so the alert was never reliable; the change is that failure is now invisible rather than logged inline. Keep an explicit `.catch(console.error)`.
- **Optimistic cart drifts from the server** → a rejected mutation reverts via `patch.undo()`, but a *silent* divergence would persist until the next read. Bounded by every mutation response reseeding the cache with server truth.
- **30s is still finite** → a pathologically slow checkout still times out. That is precisely why idempotency, not the timeout value, is the correctness mechanism; the timeout only decides how often the uncertainty message appears.
- **No automated tests exist** → every scenario in the specs is verified manually against observable DB state. Tasks call out the exact queries. This is a real gap and worth its own change later, not something to bolt on here.

## Migration Plan

1. Add `idempotencyKey String? @unique` to `prisma/schema/Order.prisma`; `pnpm migrate` to generate the migration. Additive, nullable, no backfill, no lock of consequence on a table this size.
2. Deploy the server. Key-less requests keep working, so this is safe against the current storefront.
3. Deploy the storefront (header, timeout, cart fixes).
4. **Rollback:** the storefront reverts independently. The server reverts by ignoring the header — the column can stay; dropping it is a separate, later migration, not part of a rollback.

**Verify the reported bug is actually gone:** reproduce it — place an order, confirm no `503`; then artificially delay checkout past 30s, retry with the same key, and confirm exactly one row in `Order` and one `StockMovement` set for that order.

## Open Questions

- **Where the idempotency key should live on the wire** — an `Idempotency-Key` header (the conventional choice, matching Stripe et al.) or a body field. The header is assumed throughout; if the proxy's cookie-forwarding turns out to make header passthrough awkward, a body field is an equivalent-safety swap that changes no requirement here.
- **Whether the 400ms debounce is the right feel** — a UX judgment best settled by trying it, not by specifying it. Any value in the 250–500ms range satisfies the spec.
