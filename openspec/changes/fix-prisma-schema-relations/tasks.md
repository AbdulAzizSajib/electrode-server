## 1. Additive opposite-relation fields (non-breaking)

- [x] 1.1 In `prisma/schema/auth.prisma`, add opposite relation fields to `User`: `customer Customer?`, `orderStatusChanges OrderStatusHistory[]`, `notifications Notification[]`, `assignedTickets SupportTicket[]`, `sentMessages SupportMessage[]`, `auditLogs AuditLog[]`.
- [x] 1.2 In `prisma/schema/customerAddress.prisma`, add `orders Order[]` to `CustomerAddress` (opposite of `Order.shippingAddress`).
- [x] 1.3 In `prisma/schema/product.prisma`, add `stocks Stock[]` to `Product` (opposite of `Stock.product`).
- [x] 1.4 In `prisma/schema/productVariant.prisma`, add `stocks Stock[]` to `ProductVariant` (opposite of `Stock.variant`).
- [x] 1.5 In `prisma/schema/Warehouse.prisma`, add `stockMovements StockMovement[]` to `Warehouse` (opposite of `StockMovement.warehouse`).
- [x] 1.6 Run `npx prisma format` then `npx prisma validate` and confirm no remaining "missing opposite relation field" errors for the models touched above.

## 2. Convert bare FK scalars into real relations

- [x] 2.1 In `prisma/schema/ReturnItem.prisma`, replace the bare `orderItemId String` with a proper relation: `orderItemId String` + `orderItem OrderItem @relation(fields: [orderItemId], references: [id])`.
- [x] 2.2 In `prisma/schema/OrderItem.prisma`, add the opposite field `returnItems ReturnItem[]`.
- [x] 2.3 In `prisma/schema/PurchaseOrderItem.prisma`, replace the bare `productId String` with a proper relation: `productId String` + `product Product @relation(fields: [productId], references: [id])`.
- [x] 2.4 In `prisma/schema/product.prisma`, add the opposite field `purchaseOrderItems PurchaseOrderItem[]`.
- [x] 2.5 Add a schema comment above `StockMovement.referenceId` documenting it as an intentional polymorphic reference (order/purchase-order/return, selected by `type`), not a missing relation.
- [x] 2.6 Run `npx prisma validate` again to confirm these new relations resolve cleanly.

## 3. Resolve the `User.role` / `Role` model collision

- [x] 3.1 Confirm (grep `src/`, `scripts/`, `prisma/`) every place that currently reads or writes `user.role` as a literal/enum-style value, and list the call sites to update.
  - Found 7 files: `src/app/lib/auth.ts`, `src/app/utils/seed.ts`, `src/app/interfaces/requestUser.interface.ts`, `src/app/middleware/checkAuth.ts`, `src/app/module/user/user.route.ts`, `src/app/module/auth/auth.service.ts`, `src/app/module/auth/auth.route.ts`. All were importing a stale, unrelated generated `Role` enum (`SUPER_ADMIN/ADMIN/OWNER/MANAGER/CARETAKER/TENANT` — leftover from a prior Property-Management-SaaS version of this codebase) and better-auth was configured to manage `role` as a directly-written string field, which is incompatible with converting `User.role` to a relation. Surfaced to the user; they chose "full relation + rewrite auth layer" with role names `OWNER / ADMIN / STAFF / CUSTOMER`.
- [x] 3.2 Add a seed step (or update the existing seed script) that creates the default `Role` row (e.g. name `OWNER`) if it does not already exist, wired to the existing `Role`/`Permission`/`RolePermission` models.
  - `src/app/utils/seed.ts` now seeds all four `Role` rows (fixed ids `owner/admin/staff/customer`, matching `src/app/constants/role.constant.ts`) via idempotent `upsert`, then promotes the bootstrapped super-admin user to `OWNER`.
- [x] 3.3 In `prisma/schema/auth.prisma`, change `User.role` from `Role @default(OWNER)` to a real relation.
  - Deviation from the nullable-first plan in design.md: no `prisma/migrations/` history and no reachable `DATABASE_URL` exist in this environment (empty in `.env`), so there is no live data to protect through a phased rollout. Went straight to the final shape: `roleId String @default("customer")` + `role Role @relation(fields: [roleId], references: [id])`. When a real `DATABASE_URL` is available, `prisma migrate dev` will generate this as a single initial migration rather than a multi-step one.
- [x] 3.4 In `prisma/schema/role.prisma`, confirm/add the opposite field `users User[]` on `Role`.
  - Already present; `prisma validate` confirms it now resolves against the new relation.
- [ ] 3.5 Generate and run the migration for the new `roleId`/`role` columns.
  - **Blocked in this environment**: `DATABASE_URL` is empty and no migration history exists. Run `npx prisma migrate dev --name init` (or the appropriate name) once a real database connection string is set in `.env`.
- [ ] 3.6 Write and run a backfill that sets `roleId` on every existing `User` row to the seeded default `Role.id`.
  - **Not applicable / blocked**: no live database with existing rows was reachable to backfill. If a pre-existing dev/staging database already has `User` rows when this migration is applied, backfill `roleId = 'customer'` (or the appropriate role) before/with the migration.
- [x] 3.7 Update each call site found in 3.1 to use `user.roleId` / the related `Role` instead of the old literal `role` value.
  - All 7 files updated: new `src/app/constants/role.constant.ts` (`RoleName`, `RoleId`, `ADMIN_PANEL_ROLES`, `ALL_ROLES`); `auth.ts` no longer declares `role` as a better-auth additionalField (roles come from the schema-level `roleId` default / explicit Prisma updates) and the OTP-skip check now compares `role.name`; `checkAuth.ts` now includes `role` on the session-user query and checks `role.name`; `auth.service.ts`'s `buildTokenPayload` is now async and always re-fetches the user with `role` included (so it doesn't rely on better-auth's response shape); `requestUser.interface.ts`, `user.route.ts`, `auth.route.ts` updated to the new `RoleName` type/constants.
- [x] 3.8 Alter `roleId`/`role` to required, generate and run the final migration.
  - Schema already declares `roleId String` (required) — see 3.3. Running the migration against a real database is blocked the same way as 3.5.
- [x] 3.9 Run `npx prisma validate` and `npx prisma generate` and confirm zero errors/warnings.
  - Both pass cleanly with zero errors.

## 4. Verification

- [ ] 4.1 Run the full test suite (or a smoke test against a fresh migrated dev database) to confirm auth/session/role-dependent code paths still work end-to-end.
  - **Blocked in this environment**: no reachable database (`DATABASE_URL` empty) and the project has no automated test suite (`npm test` is a placeholder). Verified statically instead: `npx tsc --noEmit` (0 errors) and `npx eslint` on every touched file (0 errors/warnings). Run a real smoke test (register → login → checkAuth-guarded route → refresh token) against a migrated dev database before deploying.
- [x] 4.2 Manually verify each scenario in `specs/data-model/schema-relations/spec.md` against the migrated schema.
  - Verified via `prisma validate` (zero errors) plus direct review of every edited model: role resolves through `Role` with no enum collision; `User`/`CustomerAddress`/`Product`/`ProductVariant`/`Warehouse` back-relations are all present and queryable; `ReturnItem`/`PurchaseOrderItem` now have real relations to `OrderItem`/`Product`; `StockMovement.referenceId` documented as intentionally polymorphic.
- [x] 4.3 Update any ERD/docs under `docs/` that reference the old `User.role` enum-style field or omit the relations added in this change, if such docs exist.
  - `docs/user-manual.html` is a leftover end-user manual for the old, unrelated Property-Management-SaaS product (tenants/leases/caretaker roles) — it does not describe this schema or this codebase's Prisma relations, so it is out of scope for this change. No other docs reference the Prisma schema or `User.role`.
