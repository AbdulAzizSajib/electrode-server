## Context

The schema lives across 34 files under `prisma/schema/*.prisma`, merged by Prisma's multi-file support into one logical schema. See `proposal.md` for the full list of broken/missing relations found. The two categories of problem require different treatment:

1. **A real naming collision** (`User.role` vs. the `Role` model) that blocks `prisma generate`/`prisma migrate` entirely — must be resolved with an actual schema change.
2. **Missing opposite relation fields / un-typed FK columns** — additive, non-breaking fixes that only add fields (no existing field is removed or retyped), except where noted.

No `openspec/specs/` existed before this change, so this is a new capability (`data-model/schema-relations`), not a modification of an existing one.

## Goals / Non-Goals

**Goals:**
- Make the schema pass `prisma validate` cleanly with zero missing-opposite-relation errors.
- Make every FK-shaped scalar column that references a single, known model a real Prisma relation, so Prisma Client can `include`/`select` it and referential actions (`onDelete`) are enforced by the database instead of the application.
- Resolve the `User.role` / `Role` model collision in a way that keeps the existing RBAC design (`Role` → `RolePermission` → `Permission`) as the single source of truth for authorization, since that system already exists in `role.prisma`/`permission.prisma`/`rolePermission.prisma` and is more capable than a hardcoded enum.

**Non-Goals:**
- Not redesigning the RBAC model itself (no new permission scopes, no multi-role-per-user support) — only wiring `User` to the existing `Role` model correctly.
- Not adding new domain capabilities the schema currently lacks entirely (e.g., `Cart`/`Wishlist` models, multi-category products, multi-currency). These are worth a separate change once this integrity fix lands; flagged in Open Questions below.
- Not changing any non-relation field (types, defaults, indexes) unless required to fix a relation.

## Decisions

### Decision: Convert `User.role` to a relation FK, not a new enum
**Options considered:**
- (a) Keep `role` as an enum on `User`, rename the RBAC model to something like `AdminRole` to remove the collision.
- (b) Convert `User.role` into `roleId String` + `role Role @relation(...)`, backed by seeded `Role` rows, and delete the enum-style default.

**Choice: (b).** The RBAC model (`Role`/`Permission`/`RolePermission`) is clearly the intended long-term authorization mechanism for an admin panel with granular permissions — a parallel hardcoded enum would immediately fall out of sync with it and defeat its purpose. Renaming the model (option a) preserves the bug's symptom (two disconnected role concepts) instead of fixing it.

**Trade-off accepted:** This is a **breaking** schema and application-code change — every place that reads `user.role === 'OWNER'` (or similar) must be updated to check `user.roleId` or the related `Role.name` / a resolved permission set. This is called out explicitly in `proposal.md` Impact and must be tracked in `tasks.md` as a first-class migration step, not an incidental one.

### Decision: Backfill via seed, not a nullable `roleId`
`User.roleId` should end up **required** (`String`, not `String?`) once backfilled, matching the intent of `@default(OWNER)` (every user always had *some* role). The migration path is: add `roleId` as optional → seed a default `Role` row (e.g. `OWNER`) → backfill all existing `User` rows to point at it → alter `roleId` to required. This is a standard three-step Prisma migration for turning an implicit default into an FK-backed default, and avoids ever leaving a `User` without a role mid-migration.

**Alternative considered:** Make `roleId` nullable permanently and treat `null` as "no role / deny all." Rejected — it pushes a subtle authorization gap into every permission check (must now handle `null` specially) for no benefit over a required FK with a guaranteed default row.

### Decision: `ReturnItem.orderItemId` and `PurchaseOrderItem.productId` become required relations, `onDelete: Restrict`
Both are business records that must remain traceable to their source line item/product; silently allowing the parent to be hard-deleted while these rows dangle would corrupt reporting and returns/inventory audit trails. Use `onDelete: Restrict` (the Prisma default when unspecified) so deletion of an `OrderItem`/`Product` that still has return/purchase history fails loudly instead of orphaning data. This matches how the rest of the schema treats historical/audit-adjacent rows (e.g. `OrderItem.product` has no explicit `onDelete`, i.e. `Restrict`).

### Decision: `StockMovement.referenceId` stays a plain scalar
It is a genuinely polymorphic reference (order fulfillment, purchase-order receipt, return, manual adjustment, etc., selected by `StockMovement.type`). Prisma has no native polymorphic relation; converting it to a single FK would be incorrect. The fix here is documentation only (a schema comment), not a structural change — captured as a task so it isn't rediscovered as a "missing relation" later.

### Decision: Additive opposite-relation fields use plain list/nullable fields, no new named relations
For `Product.stocks`, `ProductVariant.stocks`, `Warehouse.stockMovements`, `CustomerAddress.orders`, and the six `User` back-relations, the forward side (`@relation(fields: ..., references: ...)`) already exists and is unambiguous (only one relation of that shape between the two models), so plain default relation names are sufficient — no `@relation("name")` disambiguation is needed.

## Risks / Trade-offs

- **[Risk] The `User.role` migration is breaking for any running application code or seed scripts that set/read `user.role` as a literal.** → Mitigation: `tasks.md` includes an explicit step to grep the codebase (`src/`, `scripts/`) for `.role` usage on `User`/session objects and update each call site, plus update the auth seed script to create the default `Role` rows before backfilling.
- **[Risk] Adding `onDelete: Restrict`-backed relations on `ReturnItem`/`PurchaseOrderItem` could break existing dev/test data that has orphaned rows.** → Mitigation: run the new relation's migration against a schema-validated copy of dev data first (or reset dev DB, since this is pre-production); document in tasks that this must be checked before applying to any seeded environment with real data.
- **[Risk] Backfilling `roleId` requires knowing which `Role` each existing user should map to.** → Mitigation: since the current field only ever had one possible value in practice (`@default(OWNER)`, no other value could have been set without the enum existing), backfill all existing users to a single seeded default `Role` (name `OWNER`) — this is a lossless, faithful migration of current data.

## Migration Plan

1. Add the additive, non-breaking fixes first (opposite relation fields on `User`, `CustomerAddress`, `Product`, `ProductVariant`, `Warehouse`; new relations on `ReturnItem`, `PurchaseOrderItem`) and run `prisma format` + `prisma validate`.
2. Seed/ensure a default `Role` row exists (e.g. `OWNER`) via the seed script.
3. Add `User.roleId String?` + `role Role? @relation(...)`, generate and run the migration, backfill every existing `User.roleId` to the default `Role.id`.
4. Update all application code reading/writing `user.role` to use `user.roleId` / the related `Role`.
5. Alter `User.roleId`/`role` to required, remove the old enum-style `@default(OWNER)`, generate and run the final migration.
6. Run `prisma validate` and `prisma generate` as the final acceptance gate — zero errors/warnings related to relations.

Rollback: each migration step above is a separate Prisma migration file; if a step fails validation in a review environment, `prisma migrate resolve`/revert that single migration before re-attempting rather than rolling back the whole chain.

## Open Questions

- Should `Product` support multiple categories (many-to-many) instead of the current single `categoryId`? Out of scope for this integrity fix; worth a separate change if the catalog needs it.
- Should `Cart`/`CartItem`/`Wishlist` models be added now or in a follow-up change? Not a relation-integrity issue (they don't exist yet, so nothing is "broken"), left for a separate proposal.
