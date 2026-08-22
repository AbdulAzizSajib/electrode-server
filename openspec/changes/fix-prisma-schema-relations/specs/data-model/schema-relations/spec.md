## Purpose

Defines the integrity contract every relation in the Prisma data model must satisfy so the schema for the e-commerce website and admin panel compiles, migrates, and is queryable from both sides of every relation.

## ADDED Requirements

### Requirement: No colliding schema symbol names
Every model and enum name in the Prisma schema SHALL be globally unique. A field SHALL NOT reference a type name (as a relation or enum) that is ambiguous between an enum and a model, and a field using `@default(<VALUE>)` SHALL only do so when its type is an enum that declares `<VALUE>` as one of its members.

#### Scenario: User role field resolves to the RBAC Role model
- **WHEN** the schema is loaded by `prisma validate`
- **THEN** `User.role` (or its replacement `User.roleId`/`User.role` relation) resolves unambiguously to the `Role` model defined for RBAC, with no competing `Role` enum in scope
- **AND** `prisma validate` reports zero "missing opposite relation field" or "ambiguous type" errors for `User`/`Role`

#### Scenario: Every user has a resolvable role
- **WHEN** a new `User` record is created without explicitly setting a role
- **THEN** the system assigns a default `Role` (seeded, e.g. named `OWNER`) via a foreign key
- **AND** `user.roleId` references an existing `Role.id`

### Requirement: Every relation field has a matching opposite field
For every explicit `@relation` declared on one model, the related model SHALL declare the corresponding opposite relation field (a list field for the "many" side, a nullable or required object field for the "one" side).

#### Scenario: User-side back-relations exist
- **WHEN** `prisma validate` is run against the schema
- **THEN** `User` exposes opposite relation fields for `Customer.user`, `OrderStatusHistory.changedBy`, `Notification.user`, `SupportTicket.assignedTo`, `SupportMessage.sender`, and `AuditLog.user`
- **AND** no "model User is missing an opposite relation field" error is reported

#### Scenario: Address-side back-relation exists
- **WHEN** an `Order` is created referencing a `CustomerAddress` as its `shippingAddress`
- **THEN** `CustomerAddress` exposes an opposite `orders` list field that can be traversed from the address back to every order using it

#### Scenario: Inventory-side back-relations exist
- **WHEN** a `Stock` row is created linking a `Warehouse`, a `Product`, and optionally a `ProductVariant`
- **THEN** `Product` and `ProductVariant` each expose an opposite `stocks` list field
- **AND** when a `StockMovement` references a `Warehouse`, that `Warehouse` exposes an opposite `stockMovements` list field

### Requirement: Foreign-key columns that identify a real entity are declared as relations
A scalar field that stores the id of another model's row SHALL be declared as a Prisma relation (with `@relation(fields: ..., references: ...)`) rather than left as a bare, untyped scalar column, unless it is explicitly documented as a polymorphic reference that intentionally has no single target model.

#### Scenario: Return item links back to its order item
- **WHEN** a `ReturnItem` is created for a given order item
- **THEN** `ReturnItem.orderItemId` is a real relation to `OrderItem`
- **AND** `OrderItem` exposes an opposite `returnItems` list field
- **AND** deleting the parent `OrderItem` is prevented or handled explicitly (not silently orphaning the `ReturnItem`)

#### Scenario: Purchase order item links back to its product
- **WHEN** a `PurchaseOrderItem` is created for a given product
- **THEN** `PurchaseOrderItem.productId` is a real relation to `Product`
- **AND** `Product` exposes an opposite `purchaseOrderItems` list field

#### Scenario: Intentional polymorphic reference is documented, not faked as a relation
- **WHEN** a `StockMovement` is created with a `referenceId` pointing at an `Order`, `PurchaseOrder`, or `ReturnRequest` depending on its `type`
- **THEN** `referenceId` remains a plain scalar column (not a single-target Prisma relation)
- **AND** this is documented in the schema so it is not mistaken for a missing relation
