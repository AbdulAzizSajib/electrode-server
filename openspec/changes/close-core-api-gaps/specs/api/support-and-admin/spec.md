## MODIFIED Requirements

### Requirement: Audit logs are read-only and admin-scoped
`AuditLog` entries SHALL be queryable (filterable by entity/action/date/user) by OWNER/ADMIN only, and SHALL NOT be editable or deletable through the API — they are an immutable trail written by other endpoints, not user-authored content. Admin-mutating actions across the platform (catalog, inventory, marketing, checkout status changes, post-purchase moderation, RBAC, store settings) SHALL each write a corresponding `AuditLog` entry recording the action, entity, entity id, and the acting user.

#### Scenario: Attempt to delete an audit log entry
- **WHEN** any request attempts to delete an `AuditLog` row via the API
- **THEN** no such endpoint exists / the request is rejected — audit logs are append-only

#### Scenario: Admin updates a catalog product
- **WHEN** an OWNER/ADMIN updates a `Product`
- **THEN** an `AuditLog` entry is created recording an `UPDATE` action on the `Product` entity, the acting user, and the changed data

#### Scenario: OWNER changes a role's permissions
- **WHEN** an OWNER adds or removes a `RolePermission`
- **THEN** an `AuditLog` entry is created recording the action against the `RolePermission`/`Role` entity and the acting OWNER

## ADDED Requirements

### Requirement: Key lifecycle events create Notifications for the affected user
Significant lifecycle events across the platform (order status changes, payment recorded, return status changes, refund issued, review reply/moderation, a new support-ticket message) SHALL create a `Notification` for the user(s) affected by that event.

#### Scenario: Order status change notifies the customer
- **WHEN** an order's status changes
- **THEN** a `Notification` is created for the order's owning customer

#### Scenario: A new support-ticket message notifies the other participant
- **WHEN** a `SupportMessage` is posted on a `SupportTicket`
- **THEN** a `Notification` is created for the ticket's other participant (the customer if staff posted; the assigned staff user, or OWNER/ADMIN if unassigned, if the customer posted)
