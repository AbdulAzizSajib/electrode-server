## Context

- `Cart` has `customerId` XOR `guestToken`, enforced by the application, and `createdAt` / `updatedAt`. `CartItem` has `cartId` (cascade on cart delete), `productId`, `variantId`, `quantity`, `createdAt` / `updatedAt`.
- **`Cart.updatedAt` does not move when items change.** `addItem`, `updateItemQuantity` and `removeItem` write `CartItem` rows, and Prisma's `@updatedAt` only fires on an update of the row it is declared on. A cart's real activity lives on its items.
- `resolveCart` creates a guest cart for any visitor who has no `guestToken`, including on a plain `GET /cart`. A deleted cart is recreated empty on the shopper's next request, for both guests and customers.
- `withEffectivePrices(items)` returns each item with `effectiveUnitPrice` (campaign price if one applies, else `variant.offerPrice ?? product.offerPrice`). It makes one `CampaignService` call for any number of items.
- Cart routes are one router behind `router.use(optionalAuth)`, mounted at `/cart`.
- The database is MySQL through the MariaDB adapter. Raw SQL (`$queryRaw`) already has precedent in product search and the reports.
- `AuditLogService.record(userId, action, entity, entityId?, { oldData?, newData? })`.

## Goals / Non-Goals

**Goals:**
- One definition of "abandoned", applied identically by the list, the summary and the purge.
- A cart's value on the admin screen always equals what the shopper's own cart shows.
- A purge can never remove a customer's cart that still holds items.

**Non-Goals:**
- No schema change. The activity time is derived from the items, not stored on the cart.
- No scheduled cleanup and no configurable threshold (proposal, out of scope).

## Decisions

### 1. Activity is the newest item's `updatedAt`, never `Cart.updatedAt`

`CartItem.updatedAt` is set on create and on every quantity change, so `MAX(CartItem.updatedAt)` for a cart is "the last time an item was added or changed".

Prisma expresses "abandoned" directly as `items: { some: {}, none: { updatedAt: { gt: cutoff } } }`. That reads as: has an item, and no item newer than the cutoff. The summary and the purge use this filter.

Removing an item leaves no trace on the remaining items, so it does not count as activity. A shopper who only ever removes things is, for this purpose, not shopping. That is accepted.

*Alternative considered:* add a `lastActivityAt` column to `Cart` and touch it on every item write. Rejected: it needs a migration (with the trigram `DROP INDEX` hazard) and a write on every cart mutation. It is also correct only if every future item-writing path remembers to touch it, while the derived value cannot drift.

### 2. The list page is ordered by activity in SQL, then loaded with Prisma

"Newest activity first, paginated" needs an `ORDER BY MAX(ci.updatedAt)`, which Prisma's `orderBy` cannot express over a relation aggregate. So the list is done in two steps:

1. A `$queryRaw` tagged template (parameters bound, never interpolated):
   `SELECT ci.cartId, MAX(ci.updatedAt) AS lastActivityAt FROM CartItem ci GROUP BY ci.cartId HAVING MAX(ci.updatedAt) <= ${cutoff} ORDER BY lastActivityAt DESC, ci.cartId LIMIT ${limit} OFFSET ${skip}`.
   A matching `COUNT(*)` over the same grouped subquery gives `meta.total`. `cartId` breaks ties, so paging is stable.
2. `prisma.cart.findMany({ where: { id: { in: ids } } })` with an explicit `select`: `customer { firstName, lastName, phone, email }` and the items with their product and variant. The rows are re-sorted into step 1's order.

The `select` never includes `guestToken`. The response states `isGuest: customerId === null` instead. The token is the credential that opens a guest's cart, and an admin screen has no use for it.

### 3. Values come from `withEffectivePrices`, once per request

- **List:** the page's items are flattened, passed through `withEffectivePrices` in one call, and regrouped. Unit price = `effectiveUnitPrice`, line = unit × quantity, cart total = sum of its lines. All are computed in cents and returned as numbers to 2 decimals, matching how the cart computes money.
- **Summary:** counts come from Prisma `count` with the Decision 1 filter (total, `customerId: null` for guests). The value comes from loading every abandoned cart's items (a minimal `select`) through the same resolver.

*Alternative considered:* sum `offerPrice × quantity` in SQL for the summary. Rejected: it ignores campaigns, so the summary would disagree with the rows under it, which is the drift this change exists to avoid.

The cost is loading all abandoned items for the summary. That is bounded by real abandoned volume, which the purge keeps down. If it ever grows past a few thousand items, the summary can be cached. Risks section.

### 4. A second router, mounted at `/abandoned-carts`

`cart.route.ts` also exports `AbandonedCartRoutes`:

- `GET /` — `checkAuth(OWNER, ADMIN, STAFF)` → `validateQuery` (page, limit).
- `GET /summary` — `checkAuth(OWNER, ADMIN, STAFF)`.
- `DELETE /` — `checkAuth(OWNER, ADMIN)` → `validateRequest({ ids: string[1..100] })`.
- `POST /purge` — `checkAuth(OWNER, ADMIN)` → `validateRequest({ guestOlderThanDays?: 7 | 30 | 90, emptyCarts?: boolean })`, at least one of the two.

It is not under `/cart`, because that router applies `optionalAuth` to everything it mounts, and these are admin routes. `/abandoned-carts` is a new top-level mount with no parent that could swallow it, so its position in `routes/index.ts` is free. It goes beside the other admin-only mounts.

The purge is a `POST` with a body rather than a `DELETE` with query parameters. Its criteria are a small document that also goes into the audit record, and not every client sends a body on `DELETE`.

### 5. Deletion is a single `deleteMany` whose `where` holds the whole rule

- **Selected delete:** `deleteMany({ where: { id: { in: ids } } })`. Items go by the DB cascade. The returned count is reported, and ids already gone are not counted (the spec's "settles").
- **Guest purge:** `deleteMany({ where: { guestToken: { not: null }, createdAt: { lt: cutoffN }, items: { none: { updatedAt: { gt: cutoffN } } } } })`. The `createdAt` term is what makes an empty guest cart count from its creation. For a cart with items it is implied, since items cannot be older than their cart.
- **Empty purge:** `deleteMany({ where: { items: { none: {} }, createdAt: { lt: now − 24h } } })`.

Each rule is one statement, so the "no recent item" condition is evaluated when the row is deleted, not in a separate read. A shopper adding an item mid-purge either lands first, and their cart is kept, or lands after, and gets a fresh cart. Customer carts holding items match no purge rule by construction. The guest rule requires `guestToken`, and the empty rule requires no items.

The 24-hour floor on empty carts avoids deleting a cart a visitor is about to use. Deleting it would be harmless anyway (Context), but it is pointless churn.

### 6. Audit after the write, one record per request

`AuditLogService.record(userId, AuditAction.DELETE, "Cart", undefined, { oldData: … })`:
- **Selected delete:** `{ ids, deleted }`.
- **Purge:** `{ rules: { guestOlderThanDays, emptyCarts }, removed: { guest, empty } }`.

Ids are not listed for a purge, because a first purge on a long-running shop may remove thousands of rows. The criteria and counts are what make the record meaningful.

### 7. The admin page: cards, not a table

`features/customers/abandoned-carts/abandoned-carts-page.tsx` renders each cart as a card: owner, item count, total, relative time, and a disclosure for the items. It does not use `DataTable`. This follows the admin mobile direction (`add-admin-mobile-shell`, step 2): a merchant following up on a cart is usually on a phone, and a card shows the phone number and total without sideways scrolling.

- The customer's phone is a `tel:` link.
- Selection checkboxes and the toolbar with "Delete selected" and "Purge…" render only when `useSessionStore` reports OWNER or ADMIN. The backend refuses STAFF regardless, so the UI hides what the API would reject.
- The purge dialog offers the age choice (7 / 30 / 90 days) and an "also remove empty carts" switch, defaulting to 30 days and on.
- After either action, it invalidates the list and summary keys and reports the counts with a toast.

Registered in both `nav-config.ts` (Customers section, no `roles`, so every role sees it) and `app-router.tsx` (no `RoleGuard`). Per CLAUDE.md, these two must be kept in step by hand.

## Risks / Trade-offs

- **Summary cost grows with abandoned volume** → bounded by purging; cache it if needed later.
- **Item removal is not activity** → accepted (Decision 1).
- **Deleting a customer's cart discards what they chose** → only OWNER and ADMIN can do it, behind a confirmation, and it is audited. The customer sees an empty cart, not an error.
- **The raw SQL ties the list query to MySQL syntax** → it uses only `GROUP BY` / `HAVING` / `MAX`, which are portable. Column names are quoted as Prisma maps them. The verify script exercises it against the real database.

## Migration Plan

No schema change. Deploy server and admin together, or server first: the new endpoints are unused until the admin page ships. Rollback is a revert.
