## Why

A signed-in customer has no way to see the orders they have placed. The account page offers Addresses, My Reviews, Change Password, Track Order, Wishlist and Cart — but no order list. The only way back to an order is **Track Order**, which asks for the order number and phone, so the customer must keep their confirmation to hand even though they are signed in and the backend already knows every order on their account.

The backend side already exists and is already customer-scoped: `GET /orders`, `GET /orders/:id` and `PATCH /orders/:id/cancel` restrict a customer to their own orders (`api/checkout` — "A customer can only see their own orders; staff can see all"). This change is the storefront that was never built on top of them.

## What Changes

- **New "My Orders" entry in the account area**, listed first among the account shortcuts, leading to the customer's order history.
- **New page `/account/orders`**: the signed-in customer's orders, newest first, ten per page, each showing order number, date placed, status, item count and total, linking to its detail. An empty account gets an empty state that points to the shop, not a blank list.
- **New page `/account/orders/[id]`**: one order in full — status, date, items, amounts, delivery address or collection — reusing `OrderSummaryCard`, the component the checkout confirmation and Track Order already share, so the three views cannot drift.
- **Cancel from the detail page**, offered only while the order is `PENDING` or `CONFIRMED` — the statuses the backend already lets a customer cancel in — behind a confirmation step. On success the page shows the order as cancelled.
- **New storefront proxy route** for the cancel call, because it is browser-initiated and the backend's auth cookies are on the backend's own domain (the same reason the other 23 proxy routes exist).
- Both pages are behind sign-in: the proxy's optimistic `/account` gate, then the same `getCurrentUser()` check every account page makes.

Out of scope, stated so they are not mistaken for oversights:
- **Orders placed as a guest.** They belong to a separate guest customer record, not the account, so they do not appear; Track Order still finds them. Linking them by email or phone is a backend change with its own risk (a shared phone would show one person another's order) and is not attempted here.
- **Returns, refunds, reordering and invoices** from the order page.
- **Any backend change.** No endpoint, response shape or rule changes.

## Capabilities

### New Capabilities
- `storefront/order-history`: how a signed-in customer finds, reads and cancels their own orders on the storefront — the account entry point, the list, the detail view, when cancelling is offered, and what a customer who is not signed in, or who asks for someone else's order, sees.

### Modified Capabilities
None. The backend requirements this relies on (`api/checkout`: customer-scoped order reads; cancelling an unfulfilled order returns its stock; constrained status transitions) are used as they stand.

## Impact

**nextjs**
- `src/app/(shop)/account/page.tsx` — "My Orders" shortcut.
- New `src/app/(shop)/account/orders/page.tsx` and `src/app/(shop)/account/orders/[id]/page.tsx`.
- New client component for the cancel action, and `src/app/api/orders/[id]/cancel/route.ts` (a `proxyRequest` pass-through).
- `src/services/order.ts` — `getMyOrders(page)`; `getOrderById` is reused as is.
- `src/types/order.ts` — a list-item mapper, since the list response is a lighter shape than the detail.

**server** — none. **admin** — none. No env vars, no schema change.
