## Context

See proposal.md — Why. The constraints below are what actually shape the approach, and each was verified against this repository rather than assumed.

**No database tools on the host.** The server is deployed to cPanel shared hosting under Passenger (`scripts/server-deploy.sh`). `pg_dump`/`pg_restore` are not available there, and nothing in `src/` spawns a child process today — a `grep` for `child_process`/`exec(`/`spawn(` returns nothing. Introducing process spawning on shared hosting for a feature that can be built without it is not a trade worth making.

**Neon over a pooled connection.** `DATABASE_URL` points at a Neon pooler endpoint (`-pooler...neon.tech`) and there is no `directUrl`. Prisma's client is constructed with `@prisma/adapter-pg` (`src/app/lib/prisma.ts`). A restore is one long transaction against a pooled connection, so its duration is a design constraint, not an afterthought.

**Prisma's 5-second default interactive-transaction timeout.** All 27 `$transaction(` call sites in `src/` use the default. A restore covering ~57 tables will exceed it, so this is the one place that must set `timeout`/`maxWait` explicitly.

**60 models, of which ~57 are backed up.** `Session`, `AuditLog` and `Notification` are excluded per the spec. `Category` self-references via `parentId` (`CategoryHierarchy`), so it cannot be inserted in arbitrary row order even once table order is correct.

**An established module shape.** Every capability is `route/controller/service/validation/interface` under `src/app/module/<name>/`, with `checkAuth(RoleName...)` on routes and `AuditLogService.record(...)` for audit entries. Report CSV export (`report.csv.ts`) is the precedent for streaming a generated file to the browser.

## Goals / Non-Goals

**Goals:**
- A backup produced by the application, with no dependency on host binaries.
- A restore that cannot leave the shop half-written, on a connection where long transactions are a real risk.
- Refusing an unusable file *before* anything is deleted, not during.
- A table order that stays correct as the schema changes, rather than a hand-maintained list that silently rots.

**Non-Goals:**
- Being a substitute for Neon's PITR. This protects against operator error, not infrastructure loss.
- Preserving sequences, indexes, constraints, triggers or extensions. This is a data backup; the schema comes from migrations.
- Restoring across schema versions. See Decision 6.
- Scheduling, off-site upload, and partial restore — deferred, with reasons in Risks.

## Decisions

### Decision 1: The application produces the backup, via Prisma

`pg_dump` is the obvious answer and is rejected on availability: it does not exist on the target host, and reaching for it would also introduce the codebase's first child-process spawn. The alternative — asking the merchant to use the Neon console — is what the proposal exists to avoid.

So the backup is `prisma.<model>.findMany()` per included model, serialized to JSON. The cost is stated plainly: this captures **rows, not a database**. Indexes, sequences, constraints and triggers are not in the file, and are not restored. That is acceptable because the schema is owned by migrations — a restore targets a database whose schema already matches.

`Decimal`, `DateTime`, `BigInt`, `Bytes` and `Json` do not survive `JSON.stringify` round-tripping unaided (`Decimal` becomes a string that must be parsed back as a `Decimal`, not a float — this codebase stores money as `Decimal(12,2)` and reading it back as a float would corrupt totals). The serializer therefore encodes scalars by their declared Prisma type, and the parser reverses it using the same type information rather than guessing from the JSON shape.

The scalar types come from the same schema parse as the table order (Decision 2). `runtimeDataModel` would serve here — it does carry each scalar field's `type` — but taking both from one source keeps a single definition of "what the schema says" rather than two that can disagree.

### Decision 2: Table order is derived from the schema files, not hand-written

A hand-maintained ordering of 57 tables is wrong the first time someone adds a model and forgets the list. The order is computed instead: build the dependency graph from the side that holds the foreign key, and topologically sort it.

**The source of that graph is `prisma/schema/*.prisma`, parsed at startup.** This was not the first choice, and the reason matters for anyone revisiting it:

- `Prisma.dmmf` — **not available.** This project uses the `prisma-client` generator (Prisma 7), not `prisma-client-js`. Nothing in `src/generated/prisma/` exports a `dmmf`.
- `runtimeDataModel` (reachable on the client internals) — **available but insufficient.** It carries all 60 models, and each relation field's `name`, `kind`, `type` and `relationName` — but **not `relationFromFields`**. Without it there is no way to tell which side of a relation holds the foreign key: `Category.parent` and `Category.children` are identical in shape apart from the field name. Direction is exactly what a topological sort needs, so this source cannot produce one.
- `information_schema` — the real constraint graph, but it makes taking a backup depend on a database round-trip before it can start, and ties ordering to the deployed database rather than to the code that is being deployed.

The `.prisma` files declare the FK side explicitly and unambiguously — `@relation(fields: [...], references: [...])`, 76 occurrences across the schema — and `prisma/` is already rsynced to the production host (`scripts/server-deploy.sh` ships `dist/ + package.json + prisma/`), so the files are present at runtime. The parser is deliberately narrow: it reads `model` blocks and their relation attributes, and nothing else.

Write order is dependency-first (a `Product` before its `ProductVariant`); delete order is its exact reverse. Deriving both from one sort is what keeps them consistent.

A cycle in the graph is possible in principle (two models with mutually required relations). The sort detects cycles and fails loudly at startup-time validation rather than producing a subtly wrong order — a silent mis-order would surface as a foreign-key error mid-restore, which the transaction would roll back, but the operator deserves a comprehensible message.

**`Category`'s self-reference is handled separately.** Topological sort orders *tables*, not rows, so it cannot help here. Rows of a self-referencing table are inserted with the self-referencing column left null, then updated with their parent ids once every row exists. This is confined to genuinely self-referencing models and is derived from the same parse, so a second such model added later is handled without a code change.

### Decision 3: One transaction, with an explicit timeout, and validation before deletion

The spec requires atomicity, which means one interactive `$transaction`. Two things follow.

First, the timeout must be raised well above the 5s default — a full delete-and-reinsert of ~57 tables over a pooled Neon connection will not fit in five seconds. Both `timeout` and `maxWait` are set explicitly, and the chosen values are documented at the call site as *the only* such call site in the codebase, so the difference from the surrounding 27 default-timeout transactions reads as deliberate.

Second, every expensive check happens *outside* and *before* the transaction: parse the file, validate the manifest, check the format and schema versions, and verify each table's rows against the expected shape. By the time the transaction opens, the only work left is deleting and inserting. This is what makes "an untrustworthy file is refused before anything is deleted" true by construction rather than by careful ordering of `if` statements.

Rows are inserted with `createMany` per table rather than one `create` per row: ~57 statements instead of potentially tens of thousands, which is the difference between a restore that fits in a transaction and one that does not.

### Decision 4: The safety backup is taken before the transaction, and is a file the operator receives

The spec requires the pre-restore state to be recoverable. Taking it inside the restore transaction would be self-defeating: a rollback would roll the safety backup back too.

So it is taken first, as an ordinary backup, and — because there is no writable durable storage guaranteed on the host, and adding one (S3, Cloudinary) would be new infrastructure for this change — it is returned to the operator rather than stored server-side. The restore is a two-step exchange:

1. `POST /backup/restore` with the file and confirmation → the server validates the file, takes the safety backup, and returns it along with a short-lived token identifying the validated restore.
2. `POST /backup/restore/confirm` with that token → the destructive step runs.

This makes the safety backup something the operator demonstrably *has* before any data is deleted, rather than something the server claims to have taken. It also means the expensive validation is not repeated. The token is held in memory with a short expiry; if the process restarts between the two calls the operator simply resubmits, having lost nothing.

The alternative — a single call that streams a safety backup as a side effect — was rejected because a response cannot both deliver a file and report the outcome of the operation that followed it.

### Decision 5: Credentials are included, but the endpoint is OWNER-only and the file says what it is

Excluding `User`/`Account` makes a restore useless in the case it exists for: recovering from a bad state leaves nobody able to sign in. Including them means `Account.password` (a hash) and OAuth access/refresh tokens are in a file that gets downloaded to a laptop.

The resolution is not to obfuscate — a hash the restore must reproduce exactly cannot be meaningfully transformed. It is to be honest about it: OWNER-only (a strictly narrower audience than the rest of the admin panel), the download is audit-logged with the user who took it, and the UI states what the file contains before the download starts. Nothing is written into the file that the database does not already hold, so a backup discloses nothing that database access would not.

`Session` is excluded for a security reason, not merely a practical one: restoring session rows would revive sessions that had been deliberately signed out.

`Verification` rows (email/OTP challenges) are excluded on the same reasoning as `Session` — short-lived, disposable, and restoring a stale challenge is at best useless.

### Decision 6: The schema version is the migration state, and a mismatch is refused

A backup taken before a migration cannot be trusted to load into a database after it: a column that did not exist, or a table since dropped, produces either a hard error or — worse — a silently incomplete restore.

The schema version recorded in the manifest is the latest applied migration name, read from `_prisma_migrations`. A restore refuses when the file's version does not match the running application's, naming both. This is deliberately strict: a "best effort" restore across versions is exactly the sort of half-working operation that destroys confidence in a backup system.

The format version is separate and independent — it versions the *file layout*, so a future change to how the file is written can be detected and refused rather than misparsed.

### Decision 7: JSON, not CSV, and gzipped

CSV is per-table and loses type information, so a restore would be guessing whether `"1000.00"` is a string or a `Decimal`, and `null` and `""` become indistinguishable. JSON carries the structure the manifest describes.

The file is gzipped: a shop's full data as pretty JSON is large, and the download is over an ordinary connection. Node's built-in `zlib` covers this, so it adds no dependency.

## Risks / Trade-offs

**A very large shop's backup may not fit in memory** → Both directions currently materialize per-table arrays. This is bounded by the shop's actual size and is fine at the scale this system serves, but it is not unbounded-safe. Mitigation: if it approaches a limit, the per-table read becomes a paginated stream and the writer emits incrementally. Noted rather than pre-optimized.

*Measured (2026-09-06, live database):* 56 tables, 108 rows total — **13.6 KB gzipped, 47.1 KB raw, 3.5s**. Dominated by per-table round-trips rather than volume, so duration grows with the table count (fixed) far more than with rows. Three orders of magnitude of headroom before memory is a consideration.

**A restore of a large shop may exceed even the raised transaction timeout** → The timeout is set generously and the work is minimized (`createMany`, one statement per table). If a shop ever outgrows it the failure is safe — the transaction rolls back and nothing is lost — but the operator is blocked. Mitigation: measure a real restore's duration in the tasks and record the headroom.

**Pooled connection, long transaction** → A pooled Neon endpoint holds a connection for the transaction's duration. Under concurrent load a restore could contend for the pool. Accepted: a restore is a rare, deliberate, single-operator maintenance action, and it is strictly better than the alternative of a non-atomic restore.

**The backup file is a data-disclosure vector** → Mitigated as described in Decision 5 (OWNER-only, audit-logged, stated in the UI), not eliminated. A merchant who downloads a backup holds their own customer data, which is inherent to the feature existing at all.

**Excluding `AuditLog` means audit rows can outlive the data they describe** → After a restore, the log may reference an order that no longer exists. This is deliberate: an audit trail that can be rewritten by restoring an old backup is not an audit trail. The dangling reference is the lesser problem, and the restore entry itself explains the discontinuity.

**A restore is confirmed against a token held in memory** → A process restart between the two steps invalidates it. Accepted: the failure mode is "resubmit", nothing is destroyed, and the alternative (persisting pending restores) adds state for no safety gain.

## Migration Plan

No database migration. Deployment is the ordinary path — the new module ships with the server, the admin screen with the console.

There is no rollback concern for the feature itself: removing it removes two endpoints and a screen. The operation it performs is, by design, the thing that has a rollback (the safety backup).

Before the feature is announced to a merchant, the tasks require one end-to-end rehearsal against a non-production database: take a backup, change data, restore it, confirm the shop matches — including that an owner can still sign in afterwards, which is the failure that would matter most and is the least obvious to check.

## Open Questions

- **Where a safety backup should live long-term.** Returning it to the operator is correct for this change (Decision 4) and needs no infrastructure. If scheduled backups are added later they will need durable storage, and that decision — bucket, retention, encryption at rest — is better made with that requirement in hand than guessed at now. It does not affect these specs, this approach, or these tasks.
