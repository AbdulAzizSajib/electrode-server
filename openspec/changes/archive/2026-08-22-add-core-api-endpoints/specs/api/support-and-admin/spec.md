## Purpose

Covers the remaining operational surface: customer support conversations, in-app notifications, store-wide settings, RBAC administration, and audit-log visibility.

## ADDED Requirements

### Requirement: A support ticket's messages are scoped to participants
Only the ticket's owning `Customer` and the `assignedTo` `User` (or any OWNER/ADMIN) SHALL be able to read or post `SupportMessage`s on a `SupportTicket`.

#### Scenario: Unrelated customer attempts to read a ticket
- **WHEN** a customer requests a support ticket that isn't theirs
- **THEN** the response is 404

### Requirement: Notifications are per-user and markable as read
A `User` SHALL be able to list their own `Notification`s and mark one or all as read; SHALL NOT be able to read another user's notifications.

#### Scenario: Marking a notification read
- **WHEN** a user marks a notification as read
- **THEN** `isRead` becomes `true` and `readAt` is set, and it no longer counts toward their unread badge count

### Requirement: Store settings are singleton-safe through the API too
`GET`/`PATCH` on store settings SHALL always operate on the one `StoreSetting` row (fixed id `"singleton"`) — the API SHALL NOT expose any way to create a second row.

#### Scenario: Admin updates the tax rate
- **WHEN** an OWNER/ADMIN updates `defaultTaxRatePercent`
- **THEN** the single `StoreSetting` row is updated and every subsequent settings read reflects the new value

### Requirement: Only OWNER can manage roles and permissions
Creating/editing `Role`, `Permission`, or `RolePermission` records SHALL be restricted to the `OWNER` role — not ADMIN or STAFF — since this controls the privilege system itself.

#### Scenario: ADMIN attempts to grant a new permission to a role
- **WHEN** a user with the ADMIN role attempts to modify `RolePermission`
- **THEN** the request is rejected (403); only OWNER may perform this action

### Requirement: Audit logs are read-only and admin-scoped
`AuditLog` entries SHALL be queryable (filterable by entity/action/date/user) by OWNER/ADMIN only, and SHALL NOT be editable or deletable through the API — they are an immutable trail written by other endpoints, not user-authored content.

#### Scenario: Attempt to delete an audit log entry
- **WHEN** any request attempts to delete an `AuditLog` row via the API
- **THEN** no such endpoint exists / the request is rejected — audit logs are append-only
