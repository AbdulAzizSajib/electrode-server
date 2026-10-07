## 1. Backend — service

- [x] 1.1 In `server/src/app/module/cart/cart.constant.ts` add `ABANDONED_AFTER_HOURS = 24`, `GUEST_PURGE_AGE_DAYS = [7, 30, 90] as const` and `EMPTY_CART_MIN_AGE_HOURS = 24`, each with a comment citing this change. Verify `npm run lint --workspace server` passes.
- [x] 1.2 In `cart.service.ts`, add `getAbandonedCarts({ page, limit })`: the raw grouped query for the page's cart ids and the total (design.md Decision 2), then a `findMany` with an explicit `select` that excludes `guestToken`, then valuation through `withEffectivePrices` in one call (Decision 3). Return `{ data, meta }`, each cart as `{ id, isGuest, customer, items: [{ productId, variantId, name, variantName, quantity, unitPrice, lineTotal }], itemCount, total, lastActivityAt }`. Verify with task 3.1.
- [x] 1.3 Add `getAbandonedCartSummary()`: counts by Prisma with the Decision 1 filter (total and guests), and the value from all abandoned items through `withEffectivePrices`. Return `{ total, customer, guest, value }`. Verify with task 3.1.
- [x] 1.4 Add `deleteCarts(userId, ids)` and `purgeCarts(userId, { guestOlderThanDays?, emptyCarts? })`, each a single `deleteMany` per rule (Decision 5), then one `AuditLogService.record` with the payloads in Decision 6. Return the counts. Verify with task 3.1.

## 2. Backend — HTTP

- [x] 2.1 In `cart.validation.ts` add `abandonedCartsQueryZodSchema` (page, limit ≤ 50), `deleteCartsZodSchema` (`ids`: 1–100 strings) and `purgeCartsZodSchema` (`guestOlderThanDays` ∈ {7, 30, 90} optional, `emptyCarts` boolean optional, refined so at least one is set). Verify with task 2.4.
- [x] 2.2 In `cart.controller.ts` add the four handlers (read `req.validatedQuery` for the list), each only unwrapping the request, calling the service and `sendResponse` with `meta` for the list. Verify with task 2.4.
- [ ] 2.3 In `cart.route.ts` export `AbandonedCartRoutes` with the four routes and their role sets (Decision 4), and mount it in `server/src/app/routes/index.ts` as `router.use("/abandoned-carts", AbandonedCartRoutes)` beside the other admin mounts. Verify `npm run build --workspace server` succeeds (run by the user).
- [ ] 2.4 With the server running, check that STAFF gets 200 on `GET /abandoned-carts` and `GET /abandoned-carts/summary`, STAFF gets 403 on `DELETE /abandoned-carts` and `POST /abandoned-carts/purge`, no session gets 401, a purge with `guestOlderThanDays: 14` gets 400, and an empty purge body gets 400. On a NON-production database only, run one `POST /abandoned-carts/purge` as OWNER and confirm a single audit record with its rules and per-rule counts. Add the four requests to the Postman collection under a new "Abandoned Carts" folder. Verify the collection is valid JSON.

## 3. Backend — verify script

- [x] 3.1 Add `server/scripts/verify-abandoned-carts.ts` (services imported directly; `__verify_*` customer, user, products and carts created and removed in `finally`, with `CartItem.updatedAt` back-dated by direct update) asserting:
  - a cart whose items are 25h old is listed;
  - a week-old cart with a 1h-old item is not;
  - an empty cart is not;
  - no listed cart carries a `guestToken` field;
  - a campaign-priced item is valued at the campaign price;
  - the summary counts and value match the listed carts;
  - `deleteCarts` removes the cart and its items, counts only existing ids, and writes an audit record naming the ids;
  - the guest purge removes a 31-day-old guest cart and keeps a 31-day-old customer cart with items and a 1-day-old guest cart;
  - the empty purge removes a 2-day-old empty cart and keeps a 1-hour-old one.

  The purge rules are exercised through the exported `CART_PURGE_RULES`, restricted to the script's own carts. `purgeCarts` itself is NOT called: these scripts run against the real database, where an unscoped purge deletes real shoppers' carts. Its audit record is checked in task 2.4 instead.

  Verify `npx tsx scripts/verify-abandoned-carts.ts` prints only PASS lines.

## 4. Admin

- [x] 4.1 Add `admin/src/lib/api/abandoned-carts.ts` (interfaces, `getAbandonedCarts`, `getAbandonedCartSummary`, `deleteCarts`, `purgeCarts`, and their TanStack Query hooks; the mutations invalidate both keys) and `abandonedCarts` keys in `query-keys.ts`. Verify `npm run build --workspace admin` type-checks (run by the user).
- [ ] 4.2 Create `admin/src/features/customers/abandoned-carts/abandoned-carts-page.tsx` per design.md Decision 7:
  - summary tiles;
  - one card per cart (owner, item count, total, relative last activity, a disclosure listing items);
  - `tel:` and `mailto:` links for customers, "Guest" with no contact for guests;
  - an empty state;
  - pagination;
  - for OWNER and ADMIN only: selection, a "Delete selected" confirmation, and a "Purge…" dialog with 7/30/90 days (default 30) and an empty-carts switch (default on);
  - a toast reporting the counts after either action.

  Verify at 390px and 1280px with seeded abandoned carts.
- [ ] 4.3 Register the page in `admin/src/routes/nav-config.ts` (Customers section, `ShoppingCart` icon, no `roles`) and `admin/src/routes/app-router.tsx` (lazy route `/customers/abandoned-carts`, no `RoleGuard`). Verify the sidebar and the mobile drawer both list it for a STAFF login, and that STAFF sees no delete or purge controls.
- [x] 4.4 Add `abandoned-carts-page.test.tsx` covering:
  - summary and cards render from mocked hooks;
  - the empty state;
  - STAFF sees no selection, delete or purge controls;
  - OWNER can select two carts and confirm a delete, which calls the mutation with both ids;
  - cancelling the confirmation calls nothing.

  Verify `npm run test --workspace admin -- src/features/customers/abandoned-carts` passes.

## 5. Wrap-up

- [ ] 5.1 Run `npm run lint --workspace server`, `npm run lint --workspace admin` and `npm run test --workspace admin` (no new failures beyond the three known product-form/variant-editor ones), and ask the user to build both and try the page end to end: an abandoned cart appears after 24h of inactivity, calling a customer from a phone works, and delete and purge report their counts. Verify every item behaves as specified.
