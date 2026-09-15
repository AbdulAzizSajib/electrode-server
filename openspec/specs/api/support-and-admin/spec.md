# Support And Admin Specification

## Purpose

Covers the remaining operational surface: customer support conversations, in-app notifications, store-wide settings, RBAC administration, and audit-log visibility.

## Requirements

### Requirement: A support ticket's messages are scoped to participants
Only the ticket's owning `Customer` and the `assignedTo` `User` (or any OWNER/ADMIN) SHALL be able to read or post `SupportMessage`s on a `SupportTicket`.

#### Scenario: Unrelated customer attempts to read a ticket
- **WHEN** a customer requests a support ticket that isn't theirs
- **THEN** the response is 404

### Requirement: Notifications are per-user, markable as read, and deletable
A `User` SHALL be able to list their own `Notification`s, mark one or all as read, and delete their own — in bulk by id, or all those already read. A `User` SHALL NOT be able to read or delete another user's notifications; there is no admin override.

Deletion SHALL be scoped by `userId` in the query itself rather than checked beforehand, so an id belonging to another user matches nothing. Deleting an id that no longer exists SHALL NOT be an error — a repeated or concurrent clear settles rather than failing.

#### Scenario: Marking a notification read
- **WHEN** a user marks a notification as read
- **THEN** `isRead` becomes `true` and `readAt` is set, and it no longer counts toward their unread badge count

#### Scenario: Deleting selected notifications
- **WHEN** a user deletes a set of notification ids
- **THEN** only the ids belonging to that user are removed, and the count of rows actually deleted is returned

#### Scenario: Clearing read notifications
- **WHEN** a user clears all read notifications
- **THEN** every notification of theirs with `isRead` true is removed, and unread ones are left in place

#### Scenario: Attempting to delete another user's notification
- **WHEN** a user submits an id belonging to a different user
- **THEN** nothing is deleted and the reported count excludes it

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

### Requirement: Audit logs are admin-scoped and prunable by OWNER only
`AuditLog` entries SHALL be queryable (filterable by entity/action/date/user) by OWNER/ADMIN, and SHALL NOT be editable through the API — they are written by other endpoints, not user-authored content.

Entries SHALL be deletable in bulk by explicit id, by the `OWNER` role only, so the trail can be pruned as it grows. This relaxes an earlier append-only requirement, and the trade-off is explicit: an OWNER can remove the record of their own actions. Three constraints limit that, and all three are required:

- Pruning SHALL be restricted to `OWNER` — `ADMIN` may read the full trail but not prune it.
- Every purge SHALL itself write an `AuditLog` entry naming the purged ids, so a gap in the trail is always distinguishable from rows that were never written.
- Deletion SHALL accept an explicit id list only. No filtered, date-range, or unbounded purge endpoint may exist, so no single call can empty the table.

#### Scenario: OWNER prunes selected entries
- **WHEN** an OWNER deletes a set of `AuditLog` ids
- **THEN** those rows are removed, and a new `DELETE` entry recording the purged ids and count is written

#### Scenario: ADMIN attempts to prune the trail
- **WHEN** a user with the ADMIN role attempts to delete `AuditLog` rows
- **THEN** the request is rejected (403) — reading is permitted, pruning is not

#### Scenario: Attempt to edit an audit log entry
- **WHEN** any request attempts to update an `AuditLog` row via the API
- **THEN** no such endpoint exists — entries are written once and never amended
