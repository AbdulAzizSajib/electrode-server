Tasks are labelled with the repo they land in:

- **[server]** = `d:\Next.js\electrode\electrode-server`
- **[web]** = `d:\Next.js\electrode\electrode-nextjs`

Groups 1–3 ([server]) are the correctness fix and should land first. Group 4 ([web]) completes it. Groups 5–7 are the cart latency work and are independent of 1–4. There is no test runner in either repo, so every verification step is manual and observable — the exact checks are spelled out in group 8.

## 1. Idempotency — schema and migration [server]

- [x] 1.1 Add `idempotencyKey String? @unique` to `model Order` in `prisma/schema/Order.prisma` (nullable, per design D1 — this is what keeps the migration backfill-free and the deploy order unconstrained)
- [x] 1.2 Run `pnpm migrate` to generate the migration; confirm the generated SQL is an additive `ALTER TABLE ... ADD COLUMN` plus a unique index, with no data migration — migration authored by hand at `prisma/migrations/20260827000000_add_order_idempotency_key/migration.sql` (additive ADD COLUMN + unique index, no backfill) because `prisma migrate dev` writes to the live database; **run `pnpm migrate` yourself to apply it**
- [x] 1.3 Run `pnpm generate` and confirm `Order.idempotencyKey` appears in `src/generated/prisma/models/Order.ts`

## 2. Idempotency — order placement [server]

- [x] 2.1 In `order.validation.ts`, accept an optional idempotency key (UUID format) so an absent key is valid and a malformed one is rejected — per the spec scenario "Checkout without an idempotency key" — exported as `idempotencyKeyZodSchema`; applied in the controller rather than via `validateRequest`, which only ever parses `req.body` and so cannot see a header
- [x] 2.2 In `order.controller.ts`, read the `Idempotency-Key` header and pass it through to `OrderService.placeOrder` — also returns `200 "Order already placed"` instead of `201` on a replay, since nothing was created
- [x] 2.3 In `order.service.ts` `placeOrder`, before doing any work: when a key is present, look up an existing `Order` by that key and, if found **and owned by the requesting customer**, return it immediately without re-running checkout (design D1 ownership check — a key belonging to another customer must be treated as a fresh request, never returned) — `findReplayableOrder`, resolved concurrently with the cart read and checked **before** the empty-cart guard, which is what fixes the reported bug
- [x] 2.4 Persist `idempotencyKey` on the `tx.order.create` call inside the transaction
- [x] 2.5 Wrap the transaction so a `P2002` unique violation on `idempotencyKey` (check `error.meta.target` — do NOT catch `P2002` generically, per the design's stated risk) re-reads and returns the winning order instead of failing — via the shared `violatedTarget(error, field)` helper
- [x] 2.6 Log a warning when a replay is served whose stored order contents differ from the current cart, so a client bug that reuses a key too aggressively is visible rather than silent (design risk 1) — `warnIfReplayDiverges`, comparing sorted product/variant/quantity fingerprints

## 3. Checkout latency [server]

- [x] 3.1 Replace the per-item stock aggregate loop (`order.service.ts:157`, inside `for (const item of cart.items)`) with a single `groupBy` over all cart lines, then validate each line against that result in memory — N queries become 1. A product/variant absent from the result maps to 0 available, matching the old aggregate's null sums
- [x] 3.2 Replace `generateUniqueOrderNumber`'s probe loop (`:39-51`) with generate-and-insert, retrying on a `P2002` whose `meta.target` is `orderNumber` (again: branch on target, do not conflate with 2.5's key collision) — function deleted; no callers remained
- [x] 3.3 Move the post-transaction `notifyIfLowStock` loop (`:273-275`) off the request path — fire without awaiting, with an explicit `.catch(console.error)` so an unhandled rejection cannot crash the process (design D2 item 2, and the risk note about failures becoming invisible)
- [x] 3.4 ~~Leave `deductStockForOrderItem` and the transaction structure unchanged~~ — **superseded on request after the region migration below.** Once the database moved to Singapore, this loop was the largest remaining in-transaction cost (measured: 389ms of an 844ms checkout for a 2-item cart, scaling ~195ms per additional item). Replaced with `deductStockForOrderLines`, which does one ledger read for all lines and batches the writes via `unnest`-joined UPDATEs — 4 queries total regardless of cart size, versus 4 per line. Measured 398ms → 199ms at 2 items, and now flat as the cart grows. The in-transaction re-read is preserved, so concurrent orders still cannot double-spend stock; local decrementing keeps two lines drawing on the same warehouse row correct
- [x] 3.5 Measure a checkout end-to-end before and after 3.1–3.3 and record both numbers in the change notes; this is what tells you whether 30s in task 4.2 is comfortable or merely adequate — **measured, and it found a cause bigger than any of 3.1–3.3: the database was 245ms away.** See group 9

## 9. Database region [infra]

The reported 10–12s was dominated not by query count but by per-query network latency: the Postgres instance was in AWS `us-east-2` while the server ran in Bangladesh, so every one of a checkout's ~26 sequential queries paid a 245ms round trip (~6.4s of pure network) plus a 1539ms cold connect.

- [x] 9.1 Measure the baseline — `scripts/db-latency.mjs`, added for this: 245ms median round trip, 1539ms connect, ~6.4s projected checkout
- [x] 9.2 Create a new Neon project in `ap-southeast-1` (Singapore) and apply the schema with `prisma migrate deploy` — all 46 tables, all 3 migrations, `Order.idempotencyKey` confirmed present
- [x] 9.3 Copy the data across — `scripts/migrate-region.mjs`, added for this. Derives table order from the live foreign-key graph rather than hardcoding it, defers constraints for self-references (`Category.parentId`), runs as one transaction that rolls back on any failure, and refuses a non-empty target without `--truncate`. 335 rows copied; every table count matched, and FK integrity spot-checked (user→Role, OrderItem→Order, 10 Category child rows). No sequences to resync — all ids are cuid/uuid
- [x] 9.4 Re-measure: **245ms → 50ms round trip, 1539ms → 372ms connect.** Checkout dropped from 10–12s to 3–5s as observed
- [x] 9.5 Profile what remained, rather than assuming the region fix was the whole story — stage-by-stage against the live database: 844ms of queries + 361ms connect ≈ 1.2s, meaning ~2s of the observed 3–5s was outside the database (the extra post-checkout `GET /cart` in group 10, plus the browser → Next proxy → Express double hop, which local dev makes worse than production will)
- [ ] 9.6 **Left for you:** point Vercel's `DATABASE_URL` at the new database, and check which region the Vercel function runs in. Co-locating function and database is worth more than either change here — same-region RTT is ~1–5ms, which would put checkout under a second. A function in the US talking to a Singapore database would be *slower* than before
- [ ] 9.7 **Left for you:** rotate the old project's password or delete the project once you no longer need the rollback path — its connection string was pasted into a chat transcript

## 10. Post-checkout cart round trip [web]

- [x] 10.1 On a successful order, set the `getCart` cache to `EMPTY_CART` directly instead of invalidating the `Cart` tag (`src/store/orderApi.ts`). The backend empties the cart inside the same transaction that creates the order, so the outcome is already known — invalidating cost a second full round trip (browser → proxy → API → database) that the shopper waited through *after* the order had already succeeded. The 504 path still invalidates, because there the outcome genuinely is unknown. Deliberately accepted: the server's cookie-clearing side effect for a spent coupon no longer runs at this moment, which the next genuine cart read reconciles (the same asymmetry design D6 already notes)

## 4. Honest timeout handling [web]

- [x] 4.1 Give `proxyRequest` in `src/lib/api-proxy.ts` an optional `timeoutMs` parameter defaulting to the current `10_000`, so existing callers are unaffected — as an `options` object, leaving all existing 3-arg call sites untouched
- [x] 4.2 Pass `timeoutMs: 30_000` from `src/app/api/orders/route.ts`, and forward the `Idempotency-Key` request header to the backend (the proxy currently builds its header set from scratch and would otherwise drop it) — via a `FORWARDED_HEADERS` list mirroring the existing `FORWARDED_COOKIES` pattern
- [x] 4.3 Split the proxy's `catch` branch: a genuine connection failure keeps `503` + "try again"; an `AbortError` returns `504` with copy stating the outcome is unknown and directing the shopper to check their orders before retrying — per the spec's "never reported as a definite failure" (design D3). **Note:** the thrown error is named `TimeoutError`, not `AbortError` (verified on Node 22 — `AbortSignal.timeout` throws a `DOMException` named `TimeoutError`, which does satisfy `instanceof Error`), so the branch checks that name
- [x] 4.4 In `src/store/orderApi.ts`, invalidate the `Cart` tag on the timeout path as well as on success, leaving definite rejections (400/409) invalidation-free so a shopper can still fix a quantity and retry (design D5)
- [x] 4.5 In `src/components/checkout/CheckoutForm.tsx`, generate a UUID idempotency key per checkout attempt, held in state; regenerate it when the address, shipping method, or cart contents change, and specifically **do not** regenerate it when the shopper resubmits after a failure — the same key must ride the retry (design D5) — regeneration is driven by an order fingerprint (address + shipping method + sorted line/quantity pairs); notes are deliberately excluded so editing them after an unconfirmed attempt cannot turn a retry into a duplicate
- [x] 4.6 Send that key as the `Idempotency-Key` header on `placeOrder`, and confirm `errorMessage()` surfaces the new 504 copy rather than falling through to its generic fallback — confirmed (the proxy sends `message`, which `errorMessage` reads); a 504 additionally renders in amber with a "Check your orders" link to `/track-order` rather than as a red failure

## 5. Cart mutation responses [web]

- [x] 5.1 In `src/store/cartApi.ts`, replace `invalidatesTags: ["Cart"]` on `updateItemQuantity` and `removeItem` with an `onQueryStarted` that seeds the `getCart` cache from the mutation's own response via `toCartSummary` — one roundtrip per change instead of two (design D6) — shared `seedCartFromResponse` helper; `removeItem` also drops the line optimistically so the row disappears on click, reverting if the server refuses
- [x] 5.2 Do the same for `addItem`, replacing the current `itemCount`-only optimistic patch with a full seed from the response while keeping the immediate optimistic bump on the way out
- [x] 5.3 Leave the coupon mutations invalidating as they are — they legitimately need `GET /cart`'s coupon re-validation and cookie-clearing side effect (design D6, the noted asymmetry) — verified untouched

## 6. Cart quantity stepper [web]

- [x] 6.1 In `src/components/cart/CartLineControls.tsx`, hold the displayed quantity in local state that updates immediately on click, so the number tracks every click as it happens — an effect resyncs it when the server's value changes underneath (another tab, a reseed from another mutation) but never stomps a pending edit
- [x] 6.2 Debounce the server call (~400ms) so rapid clicks settle as one request carrying the final quantity, superseding any in-flight value for that line — timer cleared on unmount
- [x] 6.3 Remove `disabled={busy}` from the increase/decrease buttons — this is the visible freeze — while keeping it on the remove control where a double-fire is genuinely confusing (design D6) — the stepper now disables only while a remove is in flight, since the row is about to disappear
- [x] 6.4 On rejection, revert the displayed quantity to the last server-confirmed value and surface why it did not apply — per the spec scenario "Server rejects an optimistically applied quantity" — reverts to a `confirmed` ref and renders the backend's own message (e.g. an out-of-stock line) beneath the stepper
- [x] 6.5 Preserve the existing behavior that stepping down from 1 removes the line rather than sending an invalid quantity of 0 — also cancels any pending debounced update first, so a queued quantity cannot fire after the line is gone

## 7. Cart service query reduction [server]

- [x] 7.1 In `cart.service.ts`, add a light cart-resolution path that returns only the cart id and the guest-token side effect, without the heavy `CART_INCLUDE` (design D7) — `resolveCartId`, also returning `customerId` (needed by 7.4's discount computation)
- [x] 7.2 Use it in `addItem`, `updateItemQuantity`, and `removeItem`, leaving `getCart`'s path untouched
- [x] 7.3 In `addItem`, run cart resolution and the product/variant validation lookups concurrently with `Promise.all` — they are independent. `updateItemQuantity`/`removeItem` likewise resolve the cart and the target item concurrently; the ownership check still gates every write
- [x] 7.4 Confirm every mutation still returns the complete post-mutation cart including `discount`, since the spec now makes that response the authoritative contract clients rely on — **it did not, so this was implemented rather than merely confirmed.** `reloadCart` returned items only, while `discount` was computed solely in `getCart`; `ApiCart.discount` is non-optional client-side and `toCartSummary` reads it, so seeding the cache from a mutation response (task 5.1) would have silently dropped an applied coupon from the UI. `reloadCart` now re-validates and returns `discount`, and the controller threads the `appliedCoupon` cookie into all three mutations. Deliberately excluded: `getCart`'s clearing of a stale coupon cookie — a mutation should not mutate that cookie, and the next read reconciles it (design D6's noted asymmetry)

## 8. Verification

**Status: not run.** Every check below needs a running server, a live database, and a browser — none available in the implementation session. Static verification that *was* done: both repos typecheck (`tsc --noEmit`), both build (`pnpm build` / `next build`), and the frontend lints clean with zero errors. The runtime behaviour below is unverified until you work through it.

Before starting: apply the migration with `pnpm migrate` (task 1.2 authored the SQL but did not run it).

- [ ] 8.1 **Confirm the original bug is real and now fixed**: query `SELECT id, "orderNumber", "createdAt" FROM "Order" ORDER BY "createdAt" DESC LIMIT 5` and verify the orders from the reported 503 incidents are present — the failures were reported on orders that committed
- [ ] 8.2 **Replay returns the original order**: place an order, then re-POST with the same `Idempotency-Key`; assert the same order id comes back, that `Order` gained exactly one row, and that `StockMovement` gained exactly one set of rows
- [ ] 8.3 **Concurrent double-click**: fire two identical requests with the same key simultaneously; assert exactly one `Order` row and that both responses name it
- [ ] 8.4 **Genuine repeat purchase**: place the same cart twice with *different* keys; assert two distinct orders — the identical contents must not suppress the second
- [ ] 8.5 **No key still works**: POST with no `Idempotency-Key`; assert the order places normally and is not rejected for the header's absence
- [ ] 8.6 **Timeout copy**: force a checkout past the 30s timeout; assert a `504` whose message states the outcome is unknown, and that the cart refetches rather than continuing to show consumed items
- [ ] 8.7 **Cart roundtrips**: with devtools open, step a quantity once and assert exactly one network request; click increase five times rapidly and assert one request carrying the final quantity
- [ ] 8.8 **Stepper never freezes**: click increase repeatedly and confirm the buttons stay operable and the number tracks every click
- [ ] 8.9 **Deploy-order safety**: run the new storefront against the pre-change server (header ignored, checkout still works) and the new server against the old storefront (no header, `idempotencyKey` stays NULL) — per design D4, both orders must be safe
