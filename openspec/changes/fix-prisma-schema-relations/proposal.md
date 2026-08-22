## Why

A full read-through of `prisma/schema/*.prisma` found several broken and missing relations. The most severe is a naming collision: `User.role` is typed as `Role` with `@default(OWNER)`, but `Role` is also a real model (with `Permission`/`RolePermission`) that expects `Role.users: User[]` — this will fail `prisma validate`/`prisma generate` outright, so the schema currently cannot be migrated as-is. Beyond that, six models reference `User` (`Customer`, `OrderStatusHistory`, `Notification`, `SupportTicket`, `SupportMessage`, `AuditLog`) without the required opposite relation field on `User`, `Order.shippingAddress` has no opposite field on `CustomerAddress`, `Stock` has no opposite fields on `Product`/`ProductVariant`, `StockMovement.warehouse` has no opposite field on `Warehouse`, and `ReturnItem.orderItemId` / `PurchaseOrderItem.productId` are bare scalar columns instead of real relations. These must be fixed before the schema can be used as the foundation for an industry-standard e-commerce + admin panel build.

## What Changes

- **BREAKING**: Resolve the `User.role` vs. `Role` model collision by converting `User.role` into a real relation to the RBAC `Role` model (`roleId` FK + `role Role @relation(...)`), backed by a seeded default `Role` row (e.g. `OWNER`), instead of an enum-style `@default(OWNER)` value. This is the only viable fix — a `Role` model with `Permission`/`RolePermission` already exists for the admin panel, so introducing a second, colliding `Role` enum is not an option.
- Add the missing opposite relation fields on `User`: `customer`, `orderStatusChanges`, `notifications`, `assignedTickets`, `sentMessages`, `auditLogs`.
- Add the missing opposite relation field on `CustomerAddress`: `orders` (for `Order.shippingAddress`).
- Add the missing opposite relation fields on `Product` and `ProductVariant`: `stocks` (for `Stock.product` / `Stock.variant`).
- Add the missing opposite relation field on `Warehouse`: `stockMovements` (for `StockMovement.warehouse`).
- Convert `ReturnItem.orderItemId` from a bare scalar into a proper `@relation` to `OrderItem`, and add `OrderItem.returnItems` as the opposite field.
- Convert `PurchaseOrderItem.productId` from a bare scalar into a proper `@relation` to `Product`, and add `Product.purchaseOrderItems` as the opposite field.
- Document (no schema change) that `StockMovement.referenceId` is an intentional polymorphic reference (points at `Order`, `PurchaseOrder`, or `ReturnRequest` depending on `type`) and is not meant to be a foreign key.

## Capabilities

### New Capabilities
- `data-model/schema-relations`: Defines the required-integrity contract for the Prisma data model — every relation used by the e-commerce + admin panel domain must have both a valid forward relation and its matching opposite relation field, and no two schema symbols (models/enums) may share a name.

### Modified Capabilities
<!-- No pre-existing specs in this repo yet; nothing to modify. -->

## Impact

- **Affected files**: `prisma/schema/auth.prisma`, `role.prisma`, `customer.prisma`, `customerAddress.prisma`, `product.prisma`, `productVariant.prisma`, `Stock.prisma`, `Warehouse.prisma`, `OrderStatusHistory.prisma`, `ReturnItem.prisma`, `OrderItem.prisma`, `PurchaseOrderItem.prisma`, `Notification.prisma`, `SupportTicket.prisma`, `SupportMessage.prisma`, `AuditLog.prisma`.
- **Database**: Requires a new Prisma migration (`User.roleId` column, FK constraints, dropped `User.role` enum-style column). Requires a seed/backfill step to create a default `Role` row and set `roleId` for existing users before the column is made required.
- **Application code**: Any code reading/writing `user.role` (auth guards, middleware, seed scripts, JWT claims) must switch to `user.roleId` / `user.role.name` or an equivalent permission check via `RolePermission`.
- **No API contract changes** are implied beyond how role/permission is resolved server-side; this is a data-layer correctness fix, not a new feature.
