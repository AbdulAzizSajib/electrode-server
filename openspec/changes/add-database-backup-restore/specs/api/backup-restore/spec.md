## Purpose

Lets the shop's owner take a portable copy of the shop's data and put it back later, so an ordinary mistake — a bad import, a wrong bulk edit, an accidental delete — is recoverable from the admin panel without access to the database provider's console.

## ADDED Requirements

### Requirement: Only an OWNER can take or apply a backup
Backup and restore SHALL be reachable only by an authenticated OWNER. ADMIN, STAFF, a customer, and an unauthenticated request SHALL all be refused, and a refused request SHALL neither produce a file nor change any data.

A backup file contains every customer record in the shop and every credential row; applying one rewrites the whole shop. This is a narrower audience than the rest of the admin panel by intent, not by omission.

#### Scenario: An ADMIN attempts to download a backup
- **WHEN** a user whose role is ADMIN requests a backup
- **THEN** the request is refused with 403 and no file is produced

#### Scenario: An ADMIN attempts a restore
- **WHEN** a user whose role is ADMIN submits a restore
- **THEN** the request is refused with 403 and no data is changed

#### Scenario: An unauthenticated request
- **WHEN** a backup or restore is requested with no session
- **THEN** the request is refused with 401 and no data is read or changed

### Requirement: A backup is a single self-describing file
A backup SHALL be a single downloadable file containing the rows of every included table together with a manifest. The manifest SHALL record the format version, the moment the backup was taken, the schema version the data came from, and the list of tables included with a row count for each.

The file SHALL be self-describing: a restore SHALL be able to decide whether it can safely apply a file by reading the file alone, without being told anything about where it came from.

#### Scenario: Owner downloads a backup
- **WHEN** an OWNER requests a backup
- **THEN** a single file is returned as a download, named so that two backups taken at different times do not collide
- **AND** it contains the rows of every included table plus the manifest

#### Scenario: The manifest describes the contents
- **WHEN** a backup file is inspected
- **THEN** the manifest states the format version, when it was taken, the schema version, and every included table with its row count

#### Scenario: An empty shop still produces a valid backup
- **WHEN** a backup is taken of a shop where some included tables hold no rows
- **THEN** the file is still produced and is still restorable
- **AND** those tables appear in the manifest with a row count of zero

### Requirement: A backup covers business data, storefront content, and accounts
A backup SHALL include the shop's business records, its storefront content and settings, and the user accounts and role assignments needed to administer it after a restore.

A backup SHALL NOT include session records: restoring them would revive logins that had been signed out, and everyone signs in again after a restore regardless.

A backup SHALL NOT include the audit log or notifications. The audit log records what was done to the shop — including the restore itself — so replacing it with an older copy would destroy the record of the operation being performed.

#### Scenario: Business and content data round-trips
- **WHEN** a backup is taken and later restored into a shop whose data has since changed
- **THEN** products, variants, categories, orders, customers, stock, purchasing records, storefront content, and store settings all match the backup

#### Scenario: An owner can still sign in after a restore
- **WHEN** a backup is restored
- **THEN** the accounts and role assignments it contains are in place
- **AND** an owner in that backup can sign in with the credentials that were valid when it was taken

#### Scenario: Sessions are not restored
- **WHEN** a backup is restored
- **THEN** no session from the backup is revived, and existing sessions are not silently transferred to restored accounts

#### Scenario: The audit log survives a restore
- **WHEN** a backup taken before a series of admin actions is restored
- **THEN** the audit entries recorded for those actions are still present
- **AND** the restore itself is recorded

### Requirement: A backup file's sensitive contents are stated plainly
Because a backup contains customer personal data and credential material, the system SHALL NOT present it as an innocuous file. The admin interface SHALL state what the file contains before it is downloaded, and every download SHALL be recorded in the audit log with the user who took it.

Credential material SHALL be carried only in the form it is already stored in. The system SHALL NOT write a plaintext password, or any value it does not already hold, into a backup.

#### Scenario: A download is recorded
- **WHEN** an OWNER downloads a backup
- **THEN** an audit entry records that a backup was taken and by whom

#### Scenario: The interface says what the file holds
- **WHEN** an OWNER is about to download a backup
- **THEN** the interface states that the file contains customer data and credential material, and should be stored securely

### Requirement: A restore replaces the included tables entirely
Restoring SHALL replace the contents of the tables the backup covers with the contents of the file: a row absent from the backup SHALL NOT survive the restore, and a row present SHALL exist afterwards with the values it had when the backup was taken.

A restore SHALL NOT touch a table the backup does not cover.

#### Scenario: A row created after the backup is removed
- **WHEN** a product is created after a backup is taken, and that backup is then restored
- **THEN** the product no longer exists

#### Scenario: A row deleted after the backup returns
- **WHEN** a product is deleted after a backup is taken, and that backup is then restored
- **THEN** the product exists again with the values it had when the backup was taken

#### Scenario: A row edited after the backup reverts
- **WHEN** a product's price is changed after a backup is taken, and that backup is then restored
- **THEN** the price is the one recorded in the backup

#### Scenario: Excluded tables are untouched
- **WHEN** a restore completes
- **THEN** the audit log and notifications hold what they held before the restore, plus the entry recording the restore

### Requirement: A restore clears rows that deletion preserves
Normal operation deliberately preserves records that history depends on: a product that has been ordered or purchased is archived rather than deleted, and a removed user is marked deleted rather than removed. A restore SHALL NOT be subject to those protections — it replaces the contents of the tables it covers, so a row absent from the backup does not survive regardless of why deleting it would otherwise have been refused.

This is what makes a restore usable for returning the shop to a known state after testing.

#### Scenario: An archived product does not survive a restore
- **WHEN** a product is created after a backup is taken, is ordered so that deleting it only archives it, and that backup is then restored
- **THEN** the product no longer exists in any form, archived or otherwise

#### Scenario: A soft-deleted user does not survive a restore
- **WHEN** a user is created after a backup is taken, is then marked deleted, and that backup is restored
- **THEN** the user record no longer exists

#### Scenario: Test data leaves no residue
- **WHEN** a backup is taken, arbitrary records are created and exercised across the catalog, orders and inventory, and the backup is then restored
- **THEN** the shop's data matches the backup exactly, with none of the records created in between remaining in any state

### Requirement: A restore either completes or changes nothing
A restore SHALL be atomic. If any part fails — a malformed file, a constraint violation, a lost connection — the database SHALL be left exactly as it was before the restore began. A partially restored shop SHALL NOT be an outcome.

#### Scenario: A restore fails partway through
- **WHEN** a restore fails after some tables have been written
- **THEN** every change made by that restore is undone
- **AND** the shop's data is exactly what it was before the attempt
- **AND** the response explains that nothing was changed

#### Scenario: A restore succeeds
- **WHEN** a restore completes without error
- **THEN** the response reports what was restored, table by table, with row counts

### Requirement: A restore takes a safety backup before deleting anything
Before a restore removes any existing data, the system SHALL take a backup of the current state and make it available to the operator. Restoring the wrong file SHALL itself be recoverable.

#### Scenario: The safety backup is taken first
- **WHEN** a restore begins
- **THEN** a backup of the pre-restore state is produced before any existing row is deleted
- **AND** the response identifies it so the operator can retrieve it

#### Scenario: The safety backup survives a failed restore
- **WHEN** a restore fails and is rolled back
- **THEN** the safety backup is still available

### Requirement: A restore requires explicit confirmation
A restore SHALL require an explicit, unambiguous confirmation in the request itself. A request that merely reaches the endpoint with a file attached SHALL NOT be sufficient to destroy data.

The interface SHALL state, before the confirmation is given, that current data will be deleted and replaced.

#### Scenario: A restore without confirmation
- **WHEN** a restore is submitted with a valid file but no confirmation
- **THEN** the request is refused and no data is changed

#### Scenario: A restore with an incorrect confirmation
- **WHEN** a restore is submitted with a confirmation that does not match what was asked for
- **THEN** the request is refused and no data is changed

#### Scenario: The interface warns before asking
- **WHEN** an OWNER opens the restore flow
- **THEN** it states that restoring deletes current data and replaces it with the file's contents

### Requirement: An untrustworthy backup file is refused before anything is deleted
The system SHALL validate a submitted file before deleting any data. A file that is not a backup, is corrupt, is truncated, is of an unsupported format version, or came from an incompatible schema version SHALL be refused with an explanation of which of those it is.

Validation SHALL happen before deletion, never during: a file discovered to be unusable halfway through SHALL NOT be able to leave the shop empty.

#### Scenario: A file that is not a backup
- **WHEN** a file that is not a backup is submitted
- **THEN** it is refused with an explanation and no data is changed

#### Scenario: A corrupt or truncated file
- **WHEN** a backup file that is damaged or incomplete is submitted
- **THEN** it is refused with an explanation and no data is changed

#### Scenario: A backup from an incompatible schema version
- **WHEN** a backup whose schema version does not match the running application is submitted
- **THEN** it is refused with an explanation naming both versions, and no data is changed

#### Scenario: A backup from a newer format version
- **WHEN** a backup written in a format version the running application does not understand is submitted
- **THEN** it is refused with an explanation, and no data is changed

### Requirement: A restore is recorded in the audit log
Every restore attempt SHALL be recorded, whether it succeeded or failed, identifying the user, the moment, the file's stated origin, and the outcome.

#### Scenario: A successful restore is recorded
- **WHEN** a restore completes
- **THEN** an audit entry records who performed it, when, which backup was applied, and that it succeeded

#### Scenario: A refused or failed restore is recorded
- **WHEN** a restore is refused or fails
- **THEN** an audit entry records the attempt, who made it, and why it did not proceed
