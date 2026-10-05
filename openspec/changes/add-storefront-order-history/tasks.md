## 1. Types and service

- [x] 1.1 In `nextjs/src/types/order.ts`, add `OrderListItem` (`id`, `orderNumber`, `status`, `createdAt`, `itemCount`, `total`) and `toOrderListItem(ApiOrder)`, with `itemCount` as the sum of item quantities (design.md Decision 2). Add `CUSTOMER_CANCELLABLE_STATUSES = ["PENDING", "CONFIRMED"]` with a comment naming `CUSTOMER_CANCELLABLE_STATUSES` in `server/src/app/module/order/order.service.ts` as the source it mirrors (Decision 4). Verify with task 1.3.
- [x] 1.2 In `nextjs/src/services/order.ts`, add `getMyOrders(page)`: forwards `buildAuthCookieHeader()`, calls `GET /orders?page=<n>&limit=10` (newest first is the backend default; pass `sortBy=createdAt&sortOrder=desc` explicitly so it cannot change underneath), maps rows with `toOrderListItem`, and returns `{ orders, meta }`; returns `null` when there is no cookie or the backend answers 401. Verify `npm run lint --workspace nextjs` passes.
- [x] 1.3 Add `nextjs/src/types/order.test.ts` covering `toOrderListItem` (item count sums quantities; total parsed from the decimal string; an order with no items counts 0) and that `CUSTOMER_CANCELLABLE_STATUSES` is exactly `PENDING` and `CONFIRMED`. Verify `npm run test --workspace nextjs -- src/types/order.test.ts` passes.

## 2. Order history list

- [ ] 2.1 Create `nextjs/src/app/(shop)/account/orders/page.tsx` following `account/reviews/page.tsx`: `generateMetadata` via `resolveMetadata` ("My Orders"), `getCurrentUser()` → `redirect("/account/login?redirect=/account/orders")` when absent, "Back to account" link, heading. Read `?page=` (default 1, non-numeric → 1) and call `getMyOrders`. Verify by opening `/account/orders` signed out: it redirects to sign-in and returns to `/account/orders` after.
- [ ] 2.2 Render each order as a row linking to `/account/orders/<id>`, showing order number, date placed (localised), a status badge, "N items" and the total via `formatPrice`; render Previous/Next `<Link>`s with "Page X of Y" only when `totalPages > 1`. Verify with an account holding more than ten orders that page 2 shows the next ten and Previous returns.
- [ ] 2.3 Empty states: no orders at all → "You haven't placed an order yet", with "orders placed while signed in appear here", a link to the shop and a link to Track Order; a page past the last → "No orders on this page" with a link to page 1. Verify both by opening `/account/orders` on a new account and `/account/orders?page=99` on one with orders.

## 3. Order detail and cancel

- [ ] 3.1 Create `nextjs/src/app/(shop)/account/orders/[id]/page.tsx`: same auth check with `redirect=/account/orders/<id>`, `getOrderById(id)`, `notFound()` on `null`, "Back to my orders" link, heading with order number, status badge and date placed, then `<OrderSummaryCard order={order} />`. Verify that opening another account's order id shows the not-found page, the same as a made-up id.
- [x] 3.2 Create `nextjs/src/app/api/orders/[id]/cancel/route.ts` exporting `PATCH` as a `proxyRequest(request, "/orders/<id>/cancel", "PATCH")` pass-through. Verify `npm run lint --workspace nextjs` passes.
- [ ] 3.3 Create a client `CancelOrderButton` (under `nextjs/src/components/order/`) always mounted by the detail page with `cancellable` = status in `CUSTOMER_CANCELLABLE_STATUSES` deciding whether the button shows, so a refusal's message survives the refresh that hides the button: opens `components/ui/Modal` to confirm; on confirm `PATCH /api/orders/<id>/cancel`; on success or refusal `router.refresh()`; on refusal show the backend's message; on 504 say the result is unknown and refresh instead of inviting a retry (design.md Decision 5). Verify on a `PENDING` order that confirming cancels it and the button disappears, declining leaves it untouched, and that a `SHIPPED` order shows no button.
- [ ] 3.4 Verify the refusal path: open a `PENDING` order, move it to `PROCESSING` in the admin, then confirm cancel on the still-open page — the backend's "can no longer be cancelled" message appears and the page shows `PROCESSING`.

## 4. Entry point

- [ ] 4.1 In `nextjs/src/app/(shop)/account/page.tsx`, add `{ href: "/account/orders", label: "My Orders", icon: <an order/receipt icon from lucide-react> }` as the first entry of `shortcuts`. Verify on `/account` that "My Orders" is first and opens the history.
- [ ] 4.2 Run `npm run lint --workspace nextjs` and `npm run test --workspace nextjs`, and ask the user to run `npm run build --workspace nextjs` (builds are run by the user). Verify all pass.
