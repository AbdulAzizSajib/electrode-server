## Why

There is no way for a merchant to take a copy of their own data. If a bad import, a mistaken bulk edit, or a wrong delete damages the catalog or the order history, the only recourse is the database provider's console — which the merchant running the shop does not have, and which is not part of the admin panel they actually use.

Neon's point-in-time recovery already protects against total loss, so this is not a disaster-recovery replacement. What is missing is the ordinary operational thing: an owner being able to take a snapshot before a risky change, keep it somewhere they control, and put it back if the change went wrong.

There is a second, more immediate use for the same mechanism: **returning the shop to a known state after testing.** Deleting test data does not currently clear it. A product that has ever been ordered or purchased cannot be deleted — `deleteProduct` archives it instead (`ProductStatus.ARCHIVED`), because an order line must keep pointing at the product it sold. `User` carries `isDeleted`/`deletedAt` for the same reason. Both are correct: they protect history that must not vanish. The consequence is that repeated testing leaves residue no amount of deleting from the admin panel will remove. Restoring a backup taken before the testing removes it, because a restore replaces table contents outright rather than issuing deletes that those guards apply to.

## What Changes

- **An OWNER can download a backup of the shop's data** from the admin panel: one JSON file containing the rows of every included table, plus a manifest recording when it was taken, the format version, and the schema version it came from.
- **An OWNER can restore a backup by uploading that file**, replacing the current contents of the included tables with the file's contents. The restore runs in a single transaction: it either completes or leaves the database exactly as it was.
- **A restore clears rows that deleting cannot**, including archived products and soft-deleted users. It replaces table contents rather than issuing deletes, so the guards that keep history intact during normal operation do not preserve test residue across a restore. This makes "put the shop back the way it was before I started testing" a single action.
- **A restore takes a safety backup first**, automatically, before deleting anything. A restore that turns out to be the wrong file is itself recoverable.
- **A restore is confirmed explicitly.** It is destructive by definition, so the request must carry a typed confirmation, and the admin UI states in plain terms what is about to be deleted.
- **Backup and restore are OWNER-only** — not ADMIN, not STAFF. A backup file contains every customer record in the shop and every credential row; restoring one silently rewrites the whole shop.
- **Credentials are included but never in plaintext**, because a restore that leaves the owner unable to log in is not a restore. Password hashes and OAuth tokens are hashes and tokens, not passwords — but the file still carries them, so the response is explicit about what the file is and the download is audit-logged.
- **Sessions are excluded.** Restoring live session rows would resurrect logins that were signed out, and the table is disposable by design — everyone signs in again after a restore.
- **`AuditLog` and `Notification` are excluded** from both backup and restore. The audit log is the record of what was done to the shop *including the restore itself*; overwriting it with an older copy would erase the evidence of the operation being performed.

**BREAKING**: None. This adds endpoints and an admin screen; no existing behavior changes.

## Capabilities

### New Capabilities
- `api/backup-restore`: Taking a portable copy of the shop's data, and replacing the shop's data with a previously taken copy. Covers what a backup contains, who may take or apply one, the guarantees a restore makes (atomicity, a safety backup, explicit confirmation), and what happens when a file cannot be trusted.

### Modified Capabilities
<!-- None. The new capability is self-contained: it adds endpoints rather than
     changing the behavior of any existing one. `api/support-and-admin` covers
     settings, RBAC and audit visibility, none of whose requirements change. -->

## Impact

**New module** — `src/app/module/backup/` (route, controller, service, validation, interface), following the module layout every other capability uses.

**Endpoints** — `GET /backup/export` (download), `POST /backup/restore` (multipart upload). OWNER-only via the existing `checkAuth` middleware.

**No schema change, no migration.** This reads and writes existing tables through Prisma; it adds no model of its own.

**Admin console** — a new Database screen under the admin area, with a download action and a guarded restore flow.

**Audit log** — both operations record an `AuditLog` entry. A data export and a full overwrite are exactly the events an audit trail exists for.

**Constraints this must respect** (see design.md):
- The server runs on cPanel shared hosting under Passenger. `pg_dump`/`pg_restore` are not available and the codebase spawns no child processes anywhere; the backup is therefore produced by the application, from Prisma, not by a database tool.
- The database is Neon, reached over a pooled connection. A restore touching every table has to be mindful of statement and transaction limits rather than assuming an unlimited local session.
- Foreign keys mean rows cannot be written in arbitrary order; the restore has a defined table order and the design records how it is derived and kept correct.

**Explicitly out of scope** — scheduled/automatic backups, off-site upload (S3, Cloudinary, Drive), partial or per-table restore, and cross-schema restore (a backup from a different migration state). Each is noted in design.md with the reason.
