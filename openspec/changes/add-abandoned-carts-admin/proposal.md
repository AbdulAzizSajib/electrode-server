## Why

The merchant cannot see carts that shoppers filled and left. Every one of them sits in the database, but there is no admin screen and no admin endpoint for carts at all. The cart API is shopper-facing only (`cart.route.ts`, behind `optionalAuth`). For a logged-in customer, an abandoned cart is a sale one phone call away, and the merchant has no way to find it.

The `Cart` table also only ever grows:

- **A guest cart is deleted only when its shopper logs in and it merges** (`cart.service.ts:399,437`). A guest who never logs in leaves their cart forever.
- **Placing an order empties a cart but keeps the row** (`order.service.ts:1575`).
- **Merely reading the cart creates one.** `resolveCart` mints a guest cart for any visitor without a `guestToken` (`cart.service.ts:76-117`), so every first-time visitor who opens the cart drawer leaves an empty row behind.

Nothing ever removes the empty rows, and nothing removes old guest carts that still hold items.

## What Changes

- **A definition of "abandoned"**: a cart that holds at least one item and has had no item added or changed for **24 hours**. Activity is read from the cart's **items**, not the cart row. `Cart.updatedAt` does not move when items change, so it would call a cart abandoned while the shopper is still filling it.
- **New admin endpoints** (`/abandoned-carts`):
  - **List** abandoned carts, newest activity first, paginated. Each row shows the owner, the items with quantities, the cart's value at today's prices, and the last activity. The owner is the customer's name, phone and email for a logged-in customer, or "Guest" otherwise.
  - **Summary**: how many carts are abandoned and the total value they hold.
  - **Delete** selected carts by id.
  - **Purge** in bulk: guest carts with no activity for at least N days (7, 30 or 90), and empty carts older than 24 hours.
- **Valuation uses the price the shopper would be charged**, through the same campaign-aware resolver the shopper's own cart uses (`withEffectivePrices`), so the merchant and the shopper never see two different totals for one cart.
- **Access**: OWNER, ADMIN and STAFF can view. Only OWNER and ADMIN can delete or purge, enforced on the route.
- **Every delete and purge is audit-logged.** A selective delete names the carts; a purge records its criteria and how many rows it removed.
- **New admin page "Abandoned Carts"** under Customers: the summary on top, the list with expandable items, a tappable phone number for logged-in customers, and the delete and purge actions with a confirmation step for OWNER and ADMIN only.

Out of scope, stated so they are not mistaken for oversights:
- **Automatic cleanup.** Purging is manual. This server runs under Passenger, which sleeps when idle, so a scheduled job would not run reliably. A cPanel cron hitting a secured endpoint would be a separate change.
- **A merchant-configurable threshold.** 24 hours is fixed in one constant and can become a setting later.
- **Contacting guests.** A guest cart carries no name, phone or email, so guest rows are shown for insight and cleanup only.
- **Reminder messages** (SMS or email "you left something in your cart").

## Capabilities

### New Capabilities
- `admin-abandoned-carts`: the admin screen. What it lists and summarises, how a merchant follows up with a logged-in customer, and how deleting and purging are offered and confirmed.

### Modified Capabilities
- `api/cart-wishlist`: ADDED requirements for when a cart counts as abandoned, how it is valued, the admin read endpoints and their access, deleting and purging and their access, and the audit trail. Existing shopper-facing requirements are unchanged.

## Impact

**server**
- `src/app/module/cart/`:
  - `cart.service.ts` gains `getAbandonedCarts`, `getAbandonedCartSummary`, `deleteCarts` and `purgeCarts` (reusing `withEffectivePrices`).
  - `cart.validation.ts` gains the query and body schemas.
  - `cart.controller.ts` gains the handlers.
  - `cart.route.ts` exports a second router, `AbandonedCartRoutes`.
  - `cart.constant.ts` holds `ABANDONED_AFTER_HOURS = 24`.
- `src/app/routes/index.ts`: mounts `/abandoned-carts`.
- New `scripts/verify-abandoned-carts.ts`.
- Postman collection: the four requests.
- **No schema change, no migration.**

**admin**
- New `src/features/customers/abandoned-carts/abandoned-carts-page.tsx`.
- New `src/lib/api/abandoned-carts.ts` and its keys in `query-keys.ts`.
- Registered in both `nav-config.ts` (under Customers) and `app-router.tsx`.

**nextjs** — none.
