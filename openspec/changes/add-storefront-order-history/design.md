## Context

Everything the storefront needs from the backend already exists and is already scoped to the caller (proposal.md — Why). What the storefront already has to build on:

- `services/order.ts` `getOrderById(id)` — server-side, forwards the auth cookie, returns `null` for not-found **and** for another customer's order (the backend answers both with 404). The checkout success page uses it.
- `components/order/OrderSummaryCard.tsx` — presentational, renders items, amounts and address/collection; shared by checkout success, guest confirmation and Track Order.
- `types/order.ts` — `ApiOrder` → `Order` via `toOrder`, and an `OrderStatus` union.
- Account pages follow one shape (`account/reviews/page.tsx`): `getCurrentUser()` → `redirect("/account/login?redirect=…")` if absent, "Back to account" link, `container-px mx-auto max-w-3xl py-16`.
- `src/proxy.ts` already gates `/account` optimistically and preserves `pathname + search` in `?redirect=`.
- Backend list defaults: `limit` 10, `sortBy=createdAt`, `sortOrder=desc`; the envelope's `meta` carries `page`, `limit`, `total`, `totalPages`. The customer list strips `unitCost`.
- Backend cancel: `PATCH /orders/:id/cancel`, customer may cancel only `PENDING` / `CONFIRMED` (`CUSTOMER_CANCELLABLE_STATUSES`), refused otherwise with an `AppError` message.

## Goals / Non-Goals

**Goals:**
- Two server-rendered pages that read straight from the backend, so a reload always shows the order's real status.
- One small client island — the cancel button — and nothing else client-side.

**Non-Goals:**
- Status filtering or search on the list. Ten-per-page newest-first is enough for a storefront customer; the endpoint supports `?status=` if it is wanted later.
- Caching. Order reads are per-customer and change under staff action; `apiFetch`'s default `no-store` is correct and no revalidate tag is added.

## Decisions

### 1. Both pages are Server Components reading through `apiFetch`

The list calls a new `getMyOrders(page)` in `services/order.ts`; the detail reuses `getOrderById`. Both forward the cookie from `buildAuthCookieHeader()` exactly as `getOrderById` already does. Paging is a `?page=` search param rendered as plain Previous/Next `<Link>`s — no client state, so the back button and a shared URL both work.

*Alternative:* a client list fetching through a new `GET /api/orders` proxy, like `MyReviewsView`. Rejected: it adds a proxy route and a loading state to show data the server can render on first paint, and `/api/orders` already exists as the `POST` checkout proxy, so a `GET` on it would put two unrelated behaviours behind one file.

### 2. A list-item type, not `toOrder`

The list endpoint returns a lighter row than the detail (no payments history guarantees, no `allowedTransitions`). Feeding it through `toOrder` would either fail on a missing field or quietly default it — a total of `0` on a list is exactly the kind of wrong that looks right. A small `OrderListItem` (`id`, `orderNumber`, `status`, `createdAt`, `itemCount`, `total`) with its own `toOrderListItem` mapper reads only what the list shows.

`itemCount` is the **sum of quantities**, matching what a shopper means by "3 items" — not the number of lines.

### 3. "Not yours" and "does not exist" render the same `notFound()`

`getOrderById` already returns `null` for both because the backend returns 404 for both. The detail page calls `notFound()` on `null` and renders the app's existing not-found page. Nothing on the page distinguishes the two cases, which is what keeps order ids from being probeable.

### 4. Which statuses can be cancelled is stated once on the storefront, and the backend still decides

`CUSTOMER_CANCELLABLE_STATUSES = ["PENDING", "CONFIRMED"]` in `types/order.ts`, with a comment naming the backend constant it mirrors — the same mirror-with-obligation pattern as `SETTINGS_LIMITS` and `FALLBACK_SETTINGS`. It only decides whether the **button is shown**. The backend refuses anything else regardless, so a stale mirror can at worst show a button whose click is refused with a reason, never cancel an order it should not.

### 5. Cancel is a client button posting through a new proxy route, then `router.refresh()`

`CancelOrderButton` (client) confirms with the existing `components/ui/Modal`, then `fetch("/api/orders/<id>/cancel", { method: "PATCH" })`. `app/api/orders/[id]/cancel/route.ts` is a `proxyRequest` pass-through, because the call is browser-initiated and the backend's auth cookies live on the backend's domain — the reason every other proxy route exists.

The component is **always mounted** by the detail page and takes a `cancellable` prop that only decides whether the button shows. Mounted only while cancellable, it would be unmounted by the very refresh that follows a refusal (the order is no longer cancellable), taking the refusal message with it.

On success **and on refusal**, it calls `router.refresh()`, so the server re-reads the order and the status shown is the backend's, never one the client inferred. On refusal it also shows the backend's message (`"This order can no longer be cancelled (current status: …)"`) under the button.

The proxy distinguishes 504 (timed out, outcome unknown) from 503 (unreachable). On a 504 the button says the result is unknown and refreshes rather than inviting a second click — the cancel may have landed.

*Alternative:* a Server Action. Rejected for consistency: every browser-initiated backend mutation in this storefront goes through `proxyRequest`, and that is where the 503/504 distinction lives.

### 6. The account shortcut goes first

"My Orders" is the most common reason a signed-in customer opens their account, so it leads `shortcuts` in `account/page.tsx`. Track Order stays — it is still how guest orders are found.

## Risks / Trade-offs

- **A customer who ordered as a guest and later registered sees an empty history** → the empty state says "orders placed while signed in appear here" and links to Track Order, so the missing order has an explanation and a route.
- **The cancellable-status mirror drifts from the backend** → harmless by Decision 4 (backend refuses, page refreshes to the truth); the comment names `CUSTOMER_CANCELLABLE_STATUSES` in `order.service.ts` so it can be found.
- **Page number out of range** (`?page=99`) → the backend returns an empty page; the list renders "no orders on this page" with a link to page 1 rather than the first-time empty state, which would be untrue.

## Migration Plan

Storefront-only; deploys on its own. Rollback is a revert with nothing to unwind.
