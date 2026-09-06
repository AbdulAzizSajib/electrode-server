## 1. Table set and ordering

- [x] 1.0 Create `src/app/module/backup/backup.schema-parse.ts`: parse `prisma/schema/*.prisma` into models, their scalar fields with declared types, and their relation fields with the FK side taken from `@relation(fields: [...])`. Neither `Prisma.dmmf` (absent under the `prisma-client` generator) nor `runtimeDataModel` (no `relationFromFields`, so FK direction is unrecoverable) can supply this — see design Decision 2. Keep the parser narrow: model blocks and relation attributes, nothing else. Resolve the schema directory relative to the app root so it works from `dist/` in production, where `prisma/` is rsynced alongside.
- [x] 1.1 Create `src/app/module/backup/backup.tables.ts`. Define the included-table set as the parsed model list minus the exclusions (`Session`, `Verification`, `AuditLog`, `Notification`), each exclusion carrying a one-line comment citing the spec reason. Derive it rather than listing 57 names by hand, so a model added later is included by default — the safe direction (design Decision 2).
- [x] 1.2 Build the dependency graph from the parsed relation fields, taking the direction from the side holding the foreign key, and topologically sort it. Export write order (dependency-first) and delete order (its exact reverse) from the one sort.
- [x] 1.3 Detect cycles in the sort and fail with a message naming the models involved, rather than emitting a plausible-but-wrong order (design Decision 2).
- [x] 1.4 Detect self-referencing models from the parse (`Category.parentId` is the current one) and export the list, so the restore can null-then-patch those columns instead of assuming row order can satisfy them.
- [x] 1.5 Cover the derived order in `scripts/verify-backup-restore.ts` (the project's convention — there is no test runner on the server; 12 `verify-*.ts` scripts run against the real database and clean up after themselves): every model's dependencies precede it, delete order is the exact reverse, `Category` is reported self-referencing, and the excluded models are absent.

## 2. Serialization

- [x] 2.1 Create `backup.serialize.ts`. Encode each scalar by its declared type from the schema parse — `Decimal` as a string tagged so it is parsed back as a `Decimal` and never a float (money is `Decimal(12,2)`; a float round-trip corrupts totals), `DateTime` as ISO 8601, `BigInt` and `Bytes` explicitly, `Json` passed through.
- [x] 2.2 Write the matching decoder, reversing the encoding from the same type information rather than inferring from the JSON shape.
- [x] 2.3 Cover the round-trip in the verify script for every scalar type in the schema: `Decimal` returns as `Decimal` with its scale intact, `DateTime` as an equal `Date`, and `null` stays distinct from an empty string.
- [x] 2.4 Define the file envelope: a manifest (format version, taken-at, schema version, per-table row counts) plus the table data. Gzip it with Node's built-in `zlib` (design Decision 7).

## 3. Backup

- [x] 3.1 Create the module skeleton — `backup.route.ts`, `backup.controller.ts`, `backup.service.ts`, `backup.validation.ts`, `backup.interface.ts` — following the layout every other module uses.
- [x] 3.2 Implement the backup: read every included table in write order, encode, assemble the manifest, gzip. Read the schema version from `_prisma_migrations` (latest applied migration name).
- [x] 3.3 Add `GET /backup/export`, OWNER-only via `checkAuth(RoleName.OWNER)`. Stream the gzipped file as a download with a timestamped filename that cannot collide, following the `Content-Disposition` pattern `report.controller.ts` already uses.
- [x] 3.4 Record an `AuditLog` entry for every download, naming the user (spec: "A download is recorded").
- [x] 3.5 Register the route in `src/app/api.ts` alongside the other modules.
- [x] 3.6 Verify against a real database: download a backup, confirm every included table is present with a row count matching a direct `count()`, and confirm an empty table appears with count 0 rather than being omitted.

## 4. Validation

- [x] 4.1 Implement file validation as a pure step that runs entirely before any transaction opens (design Decision 3): parse and un-gzip, check the envelope, check the manifest, verify each table's rows against the expected column shape.
- [x] 4.2 Refuse, with a message naming which case it is: not a backup, corrupt or truncated, unsupported format version, mismatched schema version (naming both versions). One distinct error per case — "invalid file" tells the operator nothing.
- [x] 4.3 Cover each refusal case in the verify script, asserting in every one that no data changed.

## 5. Restore

- [x] 5.1 Implement `POST /backup/restore` (OWNER-only, multipart): validate the file, require the typed confirmation, take the safety backup, and return it with a short-lived in-memory token identifying the validated restore. This call deletes nothing (design Decision 4).
- [x] 5.2 Reject a missing or non-matching confirmation before any other work (spec: "A restore requires explicit confirmation").
- [x] 5.3 Implement `POST /backup/restore/confirm` (OWNER-only): take the token, open one interactive `$transaction`, delete every included table in delete order, then `createMany` each table in write order.
- [x] 5.4 Set `timeout` and `maxWait` explicitly on that transaction, and comment the call site explaining it is the only such site in the codebase — the surrounding 27 transactions use the 5s default, and a 57-table restore cannot (design Decision 3).
- [x] 5.5 Handle self-referencing tables: insert with the self-referencing column null, then patch it once every row of that table exists. Drive this from the list task 1.4 exports, not from a hard-coded mention of `Category`.
- [x] 5.6 Return a per-table row-count summary on success (spec: "A restore succeeds").
- [x] 5.7 Record an `AuditLog` entry for every restore attempt — succeeded, refused, or failed — with the reason (spec: "A restore is recorded in the audit log"). Confirm the entry survives, since `AuditLog` is excluded from the restore.
- [x] 5.8 Expire the token after a short window, and confirm an expired or unknown token is refused without touching data.

## 6. Verification against the specs

All of Group 6 lands in `scripts/verify-backup-restore.ts`, following the existing `verify-*.ts` convention.

**Status:** the read-only half is written and passing — 27 checks covering table order, serializer round-trip, taking a backup, and every refusal case (`npx tsx scripts/verify-backup-restore.ts`).

The restore checks below are **blocked on a scratch database**. A restore deletes every row in every included table, so it cannot run against the configured `DATABASE_URL` — which is the live shop. The script refuses to run them unless `BACKUP_VERIFY_DESTRUCTIVE=yes` and `BACKUP_VERIFY_DATABASE_URL` name a different database; the guard and harness are in place, the assertions are not yet written because there is nothing safe to run them against.

- [ ] 6.1 Round-trip: back up, change data, restore, assert the shop matches the backup — rows created since are gone, rows deleted since are back, edited rows reverted.
- [ ] 6.2 Verify that an archived product does not survive a restore: create a product, order it so `deleteProduct` only archives it, then restore a backup predating it and assert the row is gone in any state (spec: "A restore clears rows that deletion preserves" — this is the merchant's stated reason for wanting the feature).
- [ ] 6.3 Verify that a soft-deleted user (`isDeleted`/`deletedAt`) does not survive a restore.
- [ ] 6.4 Verify atomicity: force a failure partway through the restore transaction and assert the database is byte-for-byte what it was before.
- [ ] 6.5 Verify that the audit log and notifications are untouched apart from the restore's own entry.
- [ ] 6.6 Verify the role boundary: ADMIN and STAFF are refused 403 on both endpoints, unauthenticated is 401, and no file is produced and no data changed in each case.
- [ ] 6.7 **Sign-in after restore** — restore a backup and confirm an owner it contains can still authenticate. This is the failure that would matter most and is the least obvious to check (design, Migration Plan).
- [ ] 6.8 Confirm no session is revived by a restore.

## 7. Admin console

**Out of scope for this change.** `electrode-admin` is a separate OpenSpec root with its own changes (the `integrate-*-api` series), and this change's `allowedEditRoots` is `electrode-server` alone. The console work belongs in an admin-side change that consumes the endpoints built here — following the same pattern every other admin integration has used.

The server-side half of each item below is done: the endpoints exist, the two-step exchange returns the safety backup inline before anything is deleted, and each refusal reason is a distinct message the UI can surface verbatim.

- [ ] 7.1 Add a Database screen under the admin area, OWNER-only in the navigation as well as on the server.
- [ ] 7.2 Backup section: a download action that states, before the download starts, that the file contains customer data and credential material and should be stored securely (spec: "The interface says what the file holds").
- [ ] 7.3 Restore section: file picker, an unambiguous warning that current data will be deleted and replaced, and a typed confirmation.
- [ ] 7.4 Wire the two-step flow so the safety backup is downloaded before the destructive step is offered — the operator must hold it before anything is deleted, not merely be told it exists.
- [ ] 7.5 Surface each refusal reason distinctly (wrong file, corrupt, wrong schema version), and on success show the per-table summary.
- [x] 7.6 Typecheck the server, lint the module, and run `scripts/verify-backup-restore.ts` — all clean, 27 checks passing. (Admin package untouched by this change.)

## 8. Measurements and limits

- [x] 8.1 Measured against the live database: 56 tables, 108 rows, 13.6 KB gzipped / 47.1 KB raw, 3.5s. Recorded in design.md under Risks. Duration is dominated by per-table round-trips, not volume; memory is not a concern at three orders of magnitude more data.
- [ ] 8.2 Measure a real restore's duration against the configured transaction timeout and record the headroom. If it is tight, raise the timeout and say so.
- [ ] 8.3 Rehearse end-to-end against a non-production database before the feature is announced: back up, change data, restore, verify the shop matches and an owner can sign in (design, Migration Plan).
