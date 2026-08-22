Implementation checklist for `close-core-api-gaps`. Each numbered group is independently implementable/archivable, same posture as `add-core-api-endpoints`'s phases — see `design.md` for the underlying decisions.

## 1. Media (new `api/media` capability)

- [x] 1.1 `src/app/module/upload` (or similar): `POST /uploads/image` (OWNER/ADMIN/STAFF, `multipart/form-data`, single `file` field) — reuses the existing `multer.config.ts` + `cloudinary.config.ts` wiring already proven in `auth.controller.ts`'s avatar upload. Returns `{ url }`. No new Prisma model.
- [x] 1.2 Mount `/uploads` in `src/app/routes/index.ts`.

## 2. Inventory: keep the denormalized stock total in sync

- [x] 2.1 `stock.service.ts#adjustStock`: also apply the same `quantityDelta` to `Product`/`ProductVariant.stockQuantity` in the same transaction as the `Stock`/`StockMovement` write.
- [x] 2.2 `purchase-order.service.ts#receivePurchaseOrder`: also increment `Product`/`ProductVariant.stockQuantity` by the received quantity in the same transaction as the `Stock`/`StockMovement` write.
- [x] 2.3 Add a small reusable low-stock check helper (e.g. in `stock.service.ts` or a shared inventory util): given a product/variant id, sums `Stock.quantity` across warehouses and compares to `lowStockThreshold`; used by tasks 3.1 and 6.6 below.

## 3. Checkout: stock ledger, tax, free shipping, self-cancel

- [x] 3.1 `order.service.ts#placeOrder`: validate each line's requested quantity against `Stock.quantity` summed across all warehouses (not the denormalized total); on success, deduct largest-stock-warehouse-first (splitting across warehouses if one alone doesn't cover it), writing a `StockMovement` (`type: SALE`) per contributing warehouse, and keep decrementing `Product`/`ProductVariant.stockQuantity` in the same call (now safe to trust — see task group 2). (Low-stock check wiring happens in 6.6, alongside the other two call sites.)
- [x] 3.2 `order.service.ts#placeOrder`: compute `taxAmount` from `StoreSetting.defaultTaxRatePercent` applied to `(subtotal - discountAmount)`; waive `shippingAmount` (set to `0`) whenever `subtotal >= StoreSetting.freeShippingThreshold`, composing with the existing coupon-driven free-shipping case (either condition zeroes shipping).
- [x] 3.3 `PATCH /orders/:id/cancel` (new, any authenticated role — service layer enforces "own order" + `PENDING`/`CONFIRMED` only, 404 if not own, 400 if already past those statuses): sets `status: CANCELLED`, writes an `OrderStatusHistory` row. Add route/controller/service/validation entries alongside the existing order module files.

## 4. Post-purchase: restock on return completion

- [x] 4.1 `return.validation.ts#updateReturnStatusZodSchema`: add optional `warehouseId`, required when `status` is `COMPLETED` (schema-level or service-level check).
- [x] 4.2 `return.service.ts#updateReturnStatus`: when the new status is `COMPLETED`, increment `Stock.quantity` at `warehouseId` by each `ReturnItem`'s quantity and write a `StockMovement` (`type: RETURN`, `referenceId`: the return id) per item, in the same transaction as the status update.

## 5. Audit log: shared helper + wiring

**Paused after 5.3 per user direction (skip audit wiring for now, do Notifications next) — 5.4/5.5/5.6 remain unimplemented.**

- [x] 5.1 Add a shared `AuditLogService.record(userId, action, entity, entityId, { oldData?, newData? })` helper (new small module, e.g. `src/app/module/audit-log/audit-log.service.ts` gains this alongside its existing `getAuditLogs`).
- [x] 5.2 Wire into catalog: `category.service.ts`, `brand.service.ts`, `product.service.ts` — create/update/delete.
- [x] 5.3 Wire into inventory: `warehouse.service.ts`, `supplier.service.ts` (create/update/delete), `purchase-order.service.ts` (create/update/delete/receive), `stock.service.ts` (adjust).
- [ ] 5.4 Wire into marketing: `coupon.service.ts`, `campaign.service.ts`, `banner.service.ts` — create/update/delete.
- [ ] 5.5 Wire into checkout + post-purchase: `order.service.ts` (admin status change, and self-cancel logged with the customer as actor), `return.service.ts` (status change), `refund.service.ts` (create), `review.service.ts` (status change, admin reply).
- [ ] 5.6 Wire into support/RBAC/settings: `support-ticket.service.ts` (update), `role.service.ts` (Role/Permission create/update/delete, RolePermission assign/revoke), `store-setting.service.ts` (update).

## 6. Notifications: wiring

- [x] 6.1 `order.service.ts`: order status change (both admin `updateOrderStatus` and customer `cancelOrder` from 3.3) creates a `Notification` (`type: ORDER`) for the order's customer.
- [x] 6.2 `payment.service.ts#recordPayment`: creates a `Notification` (`type: PAYMENT`) for the order's customer.
- [x] 6.3 `return.service.ts#updateReturnStatus` and `refund.service.ts#createRefund`: create a `Notification` (`type: RETURN` / `type: REFUND`) for the order's customer.
- [x] 6.4 `review.service.ts#updateReviewStatus` and `#replyToReview`: create a `Notification` (`type: REVIEW`) for the review's customer.
- [x] 6.5 `support-ticket.service.ts#createMessage`: creates a `Notification` (`type: SUPPORT`) for the ticket's other participant (customer if staff posted; assigned staff — or every OWNER/ADMIN if unassigned — if the customer posted).
- [x] 6.6 Wire the low-stock check (2.3) into `stock.service.ts#adjustStock`, `purchase-order.service.ts#receivePurchaseOrder`, and `order.service.ts#placeOrder` (task 3.1): when a stock-decreasing movement crosses at/under `lowStockThreshold`, `createMany` a `Notification` (`type: INVENTORY`) for every OWNER/ADMIN user.
