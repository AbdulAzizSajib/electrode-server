## Context

`add-core-api-endpoints` (archived) wired every model to an endpoint following the existing five-file module pattern (`*.route/controller/service/validation/interface.ts`, `checkAuth`, `validateRequest`, `sendResponse`/`catchAsync`). This change reuses that pattern throughout — no new architectural pattern is introduced. See `proposal.md` for the audit findings and what's in/out of scope; see `specs/api/*/spec.md` for the exact behavior contracts. This document covers only the implementation decisions the specs don't pin down.

Nothing in this change requires a Prisma schema change — every gap closed here has an existing column/model that is simply unread or unwritten today (`StoreSetting.defaultTaxRatePercent`/`freeShippingThreshold`, `Stock`/`StockMovement`, `Notification`, `AuditLog`). Image upload needs no new model either (Cloudinary is external storage; the response is just a URL, not a persisted row).

## Goals / Non-Goals

**Goals:**
- Make every "settable but unread" field (tax rate, free-shipping threshold) and every "readable but unwritten" model (`Notification`, `AuditLog`) actually do something.
- Reconcile checkout's stock source of truth with the Phase 5 warehouse ledger without losing Phase 1's denormalized total (still needed for the public "in stock" read paths).
- Give the admin panel (React, per the user's stated plan) a way to upload an image instead of requiring a pre-hosted URL.

**Non-Goals:**
- **Stock reservation with expiry.** `Stock.reservedQuantity` stays unused. This change switches checkout's source of truth from the denormalized total to the `Stock` ledger, but keeps the same "deduct immediately on order placement" behavior `add-core-api-endpoints` already had — it does not add a hold-then-release reservation lifecycle (e.g. "release after 15 minutes if unpaid"). That's a materially bigger feature, not implied by this audit.
- **Payment gateway integration and transactional email** — explicitly deferred, same posture as the prior change.
- **Exhaustive notification/audit coverage of every conceivable action.** The concrete trigger lists below (Decisions) are what's implemented; anything not listed stays silent, consistent with the specs' "key events" framing rather than "every event."
- **Multi-image batch upload** — the upload endpoint accepts one file per call; a product with multiple images calls it multiple times (matching how `Product.images` is already a create/update array of `{url, ...}` objects, not a single multi-file upload contract).

## Decisions

### Decision: Checkout stock deduction — largest-warehouse-first split, no reservation
**Options considered:**
- (a) Add a `defaultWarehouseId` setting and always deduct from one warehouse, failing checkout if that warehouse alone lacks stock even when another has it.
- (b) Sum `Stock.quantity` across all warehouses for validation; deduct largest-quantity-warehouse-first, splitting across warehouses if needed.

**Choice: (b)** (user-selected). No schema change, and doesn't leave stock stranded in a second warehouse just because checkout only looked at one. `ProductVariant`/`Product.stockQuantity` keeps being decremented in the same call so Phase 1's public reads stay correct — this requires the sync fix below to hold in the other direction too (receive/adjust write it back).

### Decision: Purchase-order receiving and stock adjustment also update the denormalized total
Today `stock.service.ts#adjustStock` and `purchase-order.service.ts#receivePurchaseOrder` only touch `Stock`/`StockMovement` — never `Product`/`ProductVariant.stockQuantity`. Both now apply the same delta to the denormalized field in the same transaction as the `Stock` write. This is what makes the checkout decision above safe: the denormalized total and the ledger total stay equal by construction, so nothing downstream (Phase 1's public product reads) silently drifts.

### Decision: Return completion asks the admin which warehouse receives the stock
Mirrors `POST /purchase-orders/:id/receive`'s existing `warehouseId` field (added in `add-core-api-endpoints` for the same reason: neither `PurchaseOrderItem` nor `ReturnRequest`/`ReturnItem` carries a warehouse column). `PATCH /returns/:id/status` gains an optional `warehouseId` in the body, required only when the new status is `COMPLETED`.

### Decision: Tax is computed on the post-discount subtotal
`Order.taxAmount = (subtotal - discountAmount) * defaultTaxRatePercent / 100`. Chosen because tax on a discounted purchase should reflect what the customer actually pays for the goods, not the pre-discount list price — standard retail convention. `freeShippingThreshold` is compared against the plain `subtotal` (before discount), matching how the field is named and how a merchant would configure it ("orders over X ship free" typically means the cart's value, not the post-coupon value).

### Decision: Self-cancel is a separate endpoint, not a role-widened existing one
`PATCH /orders/:id/status` stays OWNER/ADMIN/STAFF-only, unchanged. A new `PATCH /orders/:id/cancel` is customer-facing (any authenticated role, service-layer enforces "own order, PENDING/CONFIRMED only"), writing the same `CANCELLED` status + `OrderStatusHistory` row the admin path already knows how to produce. Keeps the admin endpoint's authorization simple instead of threading a "customer can only set CANCELLED, and only their own" exception into it.

### Decision: Concrete Notification trigger list
Per `api/support-and-admin`'s new "Key lifecycle events create Notifications" requirement (representative scenarios only, not exhaustive) — the full list this change implements:

| Event | Recipient | `NotificationType` |
|---|---|---|
| Order status changes | order's customer | `ORDER` |
| Payment recorded | order's customer | `PAYMENT` |
| Return status changes | return's customer | `RETURN` |
| Refund created | order's customer | `REFUND` |
| Review status changes / admin reply | review's customer | `REVIEW` |
| New support-ticket message | the other participant (customer, or assigned staff / any OWNER+ADMIN if unassigned) | `SUPPORT` |
| Stock crosses `lowStockThreshold` | every OWNER/ADMIN | `INVENTORY` |

Each write is a plain `prisma.notification.create` (or `createMany` for the multi-recipient low-stock case) alongside the triggering mutation — in the same `$transaction` where the triggering write already uses one, otherwise as an immediate follow-up call. A notification failing to write is not allowed to fail the triggering action when it's outside a transaction (wrap in try/catch, log, continue) — an order should still be placed even if, hypothetically, the notification insert has a transient problem.

### Decision: Concrete AuditLog trigger list
Per `api/support-and-admin`'s extended "Audit logs are read-only and admin-scoped" requirement — every admin-mutating service call below writes one `AuditLog` row (`action`, `entity`, `entityId`, acting `userId`, and `oldData`/`newData` where an existing record is being changed):

- Catalog: Category/Brand/Product create, update, delete
- Inventory: Warehouse/Supplier create, update, delete; Stock adjust; PurchaseOrder create, update, delete, receive
- Marketing: Coupon/Campaign/Banner create, update, delete
- Checkout: Order status change (admin path), self-cancel (customer path, logged with the customer as actor)
- Post-purchase: Return status change, Refund create, Review status change/admin reply
- Support: SupportTicket update (status/priority/assign)
- RBAC: Role/Permission create/update/delete, RolePermission assign/revoke
- Settings: StoreSetting update

A small shared helper (e.g. `AuditLogService.record(userId, action, entity, entityId, { oldData?, newData? })`) is added and called from each service above, rather than duplicating the same `prisma.auditLog.create` shape ~25 times — this is the one new piece of shared infrastructure this change introduces.

### Decision: Upload endpoint shape
`POST /uploads/image` (OWNER/ADMIN/STAFF), `multipart/form-data` with a single `file` field, reusing the existing `multer.config.ts` + `cloudinary.config.ts` wiring already proven in `auth.controller.ts`'s avatar upload. Response: `{ url: string }`. No new Prisma model — the upload is stateless from the API's perspective (Cloudinary is the store of record for the asset itself).

## Risks / Trade-offs

- **[Risk] Splitting one order line's deduction across warehouses means a single `Order`/`OrderItem` no longer maps to a single `StockMovement`.** → Accepted: `StockMovement.referenceId` already supports many-rows-per-order (see e.g. multi-item orders today); one movement row per (order item, warehouse) pair is a natural extension, not a new pattern.
- **[Risk] The AuditLog helper touches ~15 existing service files.** → Mitigation: `tasks.md` phases this as its own checkable batch, independent of the other three areas (media, checkout/tax/stock, notifications) — if only some land in a session, the rest are still independently archivable, consistent with how `add-core-api-endpoints`'s phases worked.
- **[Risk] Tax-on-post-discount-subtotal is a judgment call, not dictated by the schema.** → Accepted and documented above; if the business needs pre-discount tax instead, it's a one-line formula change, not a re-plan.
- **[Risk] Notification volume (e.g. every order status transition) could get noisy for staff-heavy stores.** → Out of scope to solve here (no digesting/throttling); the existing `GET /notifications` filtering (`isRead`, `type`) is the only mitigation for now.

## Migration Plan

No database migration — every change is application-logic-only against existing columns/models. Deploy is a normal code release; no data backfill needed (existing `Stock`/`Product.stockQuantity` are already consistent as of `add-core-api-endpoints`'s Phase 5 rollout, assuming no manual DB edits happened outside the API since).
