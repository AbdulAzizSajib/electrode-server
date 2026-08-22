Full endpoint inventory, split into **7 phases** ordered by business dependency (see design.md's Decisions for why). Each phase is independently implementable/archivable via its own `/opsx:apply` session — none of this is built in this change; this is the plan only, per the user's "not today" instruction.

## 1. Catalog (foundation — build first, nothing else can start without it)

Models: `Category`, `Brand`, `Product`, `ProductVariant`, `ProductAttribute`, `ProductImage`, `ProductCategory`

- [x] 1.1 `src/app/module/category`: admin CRUD (`POST/GET/PATCH/DELETE /categories`, including parent/child hierarchy) + public `GET /categories`, `GET /categories/:slug`.
- [x] 1.2 `src/app/module/brand`: admin CRUD (`/brands`) + public `GET /brands`.
- [x] 1.3 `src/app/module/product`: admin CRUD (`/products`) including nested variant/image/attribute create-update, plus supplementary category tagging (`POST/DELETE /products/:id/categories/:categoryId`).
- [x] 1.4 Public product endpoints: `GET /products` (filter by category/brand/price/search, paginate, `ACTIVE`-only), `GET /products/:slug` (full detail incl. variants/images/attributes, 404 if not `ACTIVE`).
- [x] 1.5 Mount `/categories`, `/brands`, `/products` in `src/app/routes/index.ts`.

## 2. Cart & Wishlist (blocked by: Catalog)

Models: `Cart`, `CartItem`, `Wishlist`, `WishlistItem`, `CustomerAddress`

- [x] 2.1 `src/app/module/cart`: guest-token issuance/cookie handling, `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`, find-or-increment logic (closes the `CartItem` null-variant dedup gap from `docs/database-erd.html` Known Gaps).
- [x] 2.2 Cart-merge-on-login: hook into `auth.controller.ts`'s login/verify-email/OAuth-success handlers (where cookies are actually read/written) to merge a guest cart into the customer's cart per `commerce/cart` spec.
- [x] 2.3 `src/app/module/wishlist`: `GET /wishlist`, `POST /wishlist/items`, `DELETE /wishlist/items/:id` — auth required, no guest path.
- [x] 2.4 `src/app/module/customer` (address CRUD folded in, per the task's "or fold into an existing customer module"): CRUD + set-default under `/customers/me/addresses`, scoped to the requesting customer only. Also introduces `CustomerService.getOrCreateCustomerByUserId` — the shared User→Customer resolution point every subsequent phase (orders, reviews, ...) needs, since `Customer` is a separate model from `User` with no existing creation path.
- [x] 2.5 Mount `/cart`, `/wishlist`, `/customers/me/addresses` in `src/app/routes/index.ts`.

## 3. Checkout & Orders (blocked by: Cart & Wishlist)

Models: `Order`, `OrderItem`, `OrderStatusHistory`, `Payment`, `ShippingMethod`, `Shipment`

- [x] 3.1 `src/app/module/shipping-method`: admin CRUD + public `GET /shipping-methods` (active only).
- [x] 3.2 `src/app/module/order`: `POST /orders` (checkout from the customer's cart — stock/price validation, snapshot line items, clear cart on success), `GET /orders` (own orders; all orders for OWNER/ADMIN/STAFF), `GET /orders/:id` (404 if not own and not staff), `PATCH /orders/:id/status` (admin — writes `OrderStatusHistory`). NOTE: stock validation checks `Product`/`ProductVariant.stockQuantity` (Phase 1's denormalized totals), not the warehouse-scoped `Stock` ledger the spec names — `Stock` rows don't exist until Phase 5 ships and this phase is meant to be independently implementable without it (see design.md); reconcile once Phase 5 lands.
- [x] 3.3 `src/app/module/payment`: `POST /orders/:id/payments` (record a payment attempt/result), `GET /orders/:id/payments`. Gateway-agnostic per design.md (Stripe/bKash/COD wiring is a later decision, not blocked on by this phase).
- [x] 3.4 `src/app/module/shipment`: admin create/update shipment + tracking info per order, customer-facing `GET /orders/:id/shipment`. Treats "the shipment" as one-per-order (no split-shipment support), matching the schema's `Order.shipments[]` being used singularly in this spec's scenarios.
- [x] 3.5 Mount `/shipping-methods`, `/orders`, `/orders/:id/payments`, `/orders/:id/shipment` in `src/app/routes/index.ts`.

## 4. Post-Purchase (blocked by: Checkout & Orders)

Models: `Refund`, `ReturnRequest`, `ReturnItem`, `Review`

- [x] 4.1 `src/app/module/return`: `POST /orders/:id/returns` (customer-initiated, validates items/quantities against the order — including cumulative quantity already claimed by prior non-rejected/cancelled return requests, not just the single request in isolation), `GET /returns` (own / all for staff, plus a `GET /returns/:id` for the detail view), `PATCH /returns/:id/status` (admin approve/reject/complete).
- [x] 4.2 `src/app/module/refund`: `POST /orders/:id/refunds` (admin, optionally tied to a return and/or specific payment — the return link is a compound action, not a persisted FK, since `Refund` has no `returnRequestId` column: it also moves the linked `ReturnRequest` to `COMPLETED`), `GET /refunds` (admin/staff only — the task text names no customer-facing scoping here, unlike returns).
- [x] 4.3 `src/app/module/review`: `POST /products/:id/reviews` (verified-purchaser check per `api/post-purchase` spec — requires a `DELIVERED`/`COMPLETED` order containing the product, and blocks a second review from the same customer on the same product; defaults to `PENDING`), public `GET /products/:id/reviews` (`APPROVED` only), admin `GET /reviews/admin` (added beyond the literal task text — otherwise there's no way to discover which reviews are pending moderation) + `PATCH /reviews/:id/status` (moderation) + `PATCH /reviews/:id` (admin reply).
- [x] 4.4 Mount `/returns`, `/refunds`, `/orders/:id/returns`, `/orders/:id/refunds` in `src/app/routes/index.ts`; reviews mount at `/products/:id/reviews` (create + public list) and `/reviews` (admin moderation).

## 5. Inventory & Procurement (blocked by: Catalog; independent of Checkout/Marketing — can run in parallel with Phase 6)

Models: `Warehouse`, `Stock`, `StockMovement`, `Supplier`, `PurchaseOrder`, `PurchaseOrderItem`

- [x] 5.1 `src/app/module/warehouse`: admin CRUD.
- [x] 5.2 `src/app/module/stock`: admin `GET /stock` (by warehouse/product/variant), `PATCH /stock/:id/adjust` (always writes a `StockMovement`, per `api/inventory` spec), `GET /stock-movements` (read-only ledger, filterable).
- [x] 5.3 `src/app/module/supplier`: admin CRUD.
- [x] 5.4 `src/app/module/purchase-order`: admin CRUD + `POST /purchase-orders/:id/receive` (increments stock + writes `StockMovement`, supports partial receipt per spec).
- [x] 5.5 Mount `/warehouses`, `/stock`, `/stock-movements`, `/suppliers`, `/purchase-orders` in `src/app/routes/index.ts`.

## 6. Marketing (blocked by: Catalog; needs Checkout for coupon-at-cart application — can build coupon/campaign/banner CRUD in parallel with Phase 5, but the "apply coupon to cart" endpoint needs Phase 2's Cart)

Models: `Coupon`, `CouponProduct`, `Campaign`, `CampaignProduct`, `Banner`

- [x] 6.1 `src/app/module/coupon`: admin CRUD (incl. `CouponProduct` scoping) + `POST /cart/apply-coupon` / `DELETE /cart/coupon` (validates per `api/marketing` spec: status, dates, usage limits, product eligibility). Also wired into checkout: `order.service.ts`'s `placeOrder` re-validates the cart's applied coupon (carried via an `appliedCoupon` cookie, mirroring `guestToken` — `Cart` has no column for it), applies the discount/free-shipping to the order, sets `Order.couponCode`, and increments `Coupon.usageCount` — making `perCustomerLimit` real.
- [x] 6.2 `src/app/module/campaign`: admin CRUD (incl. `CampaignProduct` scoping) — campaign-discounted price reflected automatically in product read endpoints from Phase 1 once active (no separate customer-facing endpoint needed).
- [x] 6.3 `src/app/module/banner`: admin CRUD + public `GET /banners` (active + in-window only, per spec).
- [x] 6.4 Mount `/coupons`, `/campaigns`, `/banners` in `src/app/routes/index.ts`.

## 7. Support, Notifications & Admin Governance (blocked by: Checkout for ticket linkage context; otherwise independent — lowest urgency for a single-owner store, per design.md)

Models: `SupportTicket`, `SupportMessage`, `Notification`, `StoreSetting`, `Role`, `Permission`, `RolePermission`, `AuditLog`

- [x] 7.1 `src/app/module/support-ticket`: `POST /support-tickets` (customer), `GET /support-tickets` (own / all for staff), `POST /support-tickets/:id/messages`, `GET /support-tickets/:id/messages` (participant-scoped per spec), admin `PATCH /support-tickets/:id` (status/priority/assign).
- [x] 7.2 `src/app/module/notification`: `GET /notifications` (own only), `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`.
- [x] 7.3 `src/app/module/store-setting`: `GET /settings` (admin), `PATCH /settings` (OWNER/ADMIN, always the singleton row per spec).
- [x] 7.4 `src/app/module/role`: OWNER-only CRUD for `Role`, `Permission`, `RolePermission`.
- [x] 7.5 `src/app/module/audit-log`: `GET /audit-logs` (OWNER/ADMIN, filterable, read-only — no write/delete endpoint per spec).
- [x] 7.6 Mount `/support-tickets`, `/notifications`, `/settings`, `/roles`, `/permissions`, `/audit-logs` in `src/app/routes/index.ts`.
