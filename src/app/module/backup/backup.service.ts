import crypto from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import status from "http-status";
import { AuditAction } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
    BACKUP_FORMAT_VERSION,
    type BackupArtifact,
    type BackupFile,
    type BackupManifest,
    type PendingRestore,
    type RestoreSummary,
} from "./backup.interface";
import {
    assertRowsMatchModel as assertRowsMatchModelImpl,
    decodeRows,
    encodeRows,
    type EncodedRow,
} from "./backup.serialize";

/*
 * Re-declared with an explicit type. TypeScript will not accept an assertion
 * function called through an inferred binding ("Assertions require every name
 * in the call target to be declared with an explicit type annotation"), which
 * an `import` produces.
 */
const assertRowsMatchModel: (modelName: string, rows: unknown) => asserts rows is EncodedRow[] =
    assertRowsMatchModelImpl;
import { clientKeyOf, getTableOrder } from "./backup.tables";

/**
 * Taking a copy of the shop's data, and putting one back.
 *
 * The shape of this module is set by two constraints, both documented in
 * add-database-backup-restore design.md:
 *
 *   - There is no `pg_dump` on the host (cPanel shared hosting) and the
 *     codebase spawns no child processes, so the backup is produced by the
 *     application through Prisma (Decision 1).
 *   - A restore must be atomic, so it is one interactive transaction — and
 *     everything that can fail is done BEFORE that transaction opens, so an
 *     unusable file can never leave the shop half-emptied (Decision 3).
 */

/**
 * How long a validated restore waits for its confirmation.
 *
 * Long enough for an operator to read the summary and save the safety backup;
 * short enough that a forgotten pending restore cannot be confirmed by
 * accident an hour later.
 */
const PENDING_RESTORE_TTL_MS = 10 * 60 * 1000;

/**
 * The confirmation an operator must type. Compared exactly — a restore is
 * destructive, so "are you sure?" is not enough (spec: "A restore requires
 * explicit confirmation").
 */
export const RESTORE_CONFIRMATION = "RESTORE";

/**
 * Validated restores awaiting confirmation, in memory.
 *
 * Not persisted deliberately (design Decision 4): a process restart between
 * the two calls simply invalidates the pending restore, and the operator
 * resubmits having lost nothing. Persisting it would add state whose only
 * effect is to let a stale restore survive a deploy.
 */
const pendingRestores = new Map<string, PendingRestore>();

const prunePendingRestores = () => {
    const now = Date.now();
    for (const [token, pending] of pendingRestores) {
        if (pending.expiresAt <= now) pendingRestores.delete(token);
    }
};

/**
 * The latest applied migration — the schema the current data belongs to.
 *
 * A restore compares this against the file's; see design Decision 6 for why a
 * mismatch is refused outright rather than attempted.
 */
const getSchemaVersion = async (): Promise<string> => {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name
        FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC
        LIMIT 1
    `;

    if (rows.length === 0) {
        throw new AppError(
            status.INTERNAL_SERVER_ERROR,
            "Cannot determine the database schema version: no applied migrations were found.",
        );
    }

    return rows[0].migration_name;
};

/** A filename two backups taken in the same minute cannot share. */
const backupFilename = (takenAt: Date): string => {
    const stamp = takenAt.toISOString().replace(/[:.]/g, "-");
    return `electrode-backup-${stamp}.json.gz`;
};

/**
 * Reads every included table and returns the gzipped file.
 *
 * Tables are read in write order so the manifest lists them in the order a
 * restore will apply them — the file then reads as the sequence of operations
 * it describes.
 */
const createBackup = async (): Promise<BackupArtifact> => {
    const { writeOrder } = getTableOrder();
    const schemaVersion = await getSchemaVersion();
    const takenAt = new Date();

    const data: Record<string, EncodedRow[]> = {};
    const tables: BackupManifest["tables"] = [];

    for (const modelName of writeOrder) {
        const delegate = (prisma as never as Record<string, { findMany: () => Promise<Record<string, unknown>[]> }>)[
            clientKeyOf(modelName)
        ];

        if (!delegate?.findMany) {
            throw new AppError(
                status.INTERNAL_SERVER_ERROR,
                `No Prisma delegate for model "${modelName}" — the schema and the generated client disagree.`,
            );
        }

        const rows = await delegate.findMany();
        const encoded = encodeRows(modelName, rows);

        // Every table appears, including empty ones: a table missing from the
        // file and a table that is genuinely empty must not look alike to a
        // restore (spec: "An empty shop still produces a valid backup").
        data[modelName] = encoded;
        tables.push({ name: modelName, rowCount: encoded.length });
    }

    const manifest: BackupManifest = {
        formatVersion: BACKUP_FORMAT_VERSION,
        takenAt: takenAt.toISOString(),
        schemaVersion,
        tables,
    };

    const file: BackupFile = { manifest, data };

    return {
        content: gzipSync(Buffer.from(JSON.stringify(file), "utf8")),
        filename: backupFilename(takenAt),
        manifest,
    };
};

/** `GET /backup/export` — takes a backup and records that it was taken. */
const exportBackup = async (userId: string): Promise<BackupArtifact> => {
    const artifact = await createBackup();

    await AuditLogService.record(userId, AuditAction.EXPORT, "Backup", undefined, {
        newData: artifact.manifest,
    });

    return artifact;
};

/**
 * Turns an uploaded buffer into a `BackupFile`, or refuses it.
 *
 * Runs entirely before any transaction opens. Every reason a file might be
 * unusable is checked here, so the destructive step that follows has nothing
 * left to discover (design Decision 3, and the spec's "An untrustworthy backup
 * file is refused before anything is deleted").
 */
const parseAndValidate = async (buffer: Buffer): Promise<BackupFile> => {
    let text: string;
    try {
        text = gunzipSync(buffer).toString("utf8");
    } catch {
        throw new AppError(
            status.BAD_REQUEST,
            "This file is not a readable backup — it could not be decompressed. It may be corrupt, truncated, or not a backup file at all.",
        );
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new AppError(
            status.BAD_REQUEST,
            "This backup file is corrupt: its contents are not valid JSON. It may have been truncated during download.",
        );
    }

    if (typeof parsed !== "object" || parsed === null) {
        throw new AppError(status.BAD_REQUEST, "This file is not a backup.");
    }

    const file = parsed as Partial<BackupFile>;
    const manifest = file.manifest;

    if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.tables) || !file.data) {
        throw new AppError(
            status.BAD_REQUEST,
            "This file is not a backup: it has no manifest describing what it contains.",
        );
    }

    if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
        throw new AppError(
            status.BAD_REQUEST,
            `This backup is in format version ${manifest.formatVersion}, and this application understands version ${BACKUP_FORMAT_VERSION}. It cannot be restored here.`,
        );
    }

    const schemaVersion = await getSchemaVersion();
    if (manifest.schemaVersion !== schemaVersion) {
        throw new AppError(
            status.BAD_REQUEST,
            `This backup was taken from schema version "${manifest.schemaVersion}", but the database is now at "${schemaVersion}". Restoring across schema versions is refused because it would produce a partially-populated database.`,
        );
    }

    // Every table the restore will write must be present, and its rows must
    // look like rows of that table. An unknown column is the clearest signal
    // that the file describes a different schema than the manifest claims.
    const { writeOrder } = getTableOrder();
    for (const modelName of writeOrder) {
        const rows = (file.data as Record<string, unknown>)[modelName];

        if (rows === undefined) {
            throw new AppError(
                status.BAD_REQUEST,
                `This backup is incomplete: it has no data for table "${modelName}". Restoring it would leave that table empty.`,
            );
        }

        assertRowsMatchModel(modelName, rows);
    }

    return file as BackupFile;
};

/**
 * Step one of a restore: validate, take the safety backup, hand both back.
 *
 * Deletes nothing. The operator receives the safety backup before anything is
 * destroyed — so it is something they demonstrably hold, not something the
 * server claims to have taken (design Decision 4).
 */
const prepareRestore = async (
    userId: string,
    buffer: Buffer,
    confirmation: string | undefined,
): Promise<{ token: string; expiresAt: number; safetyBackup: BackupArtifact; manifest: BackupManifest }> => {
    // Checked first: a request that does not mean it should not cause the work
    // of parsing a file, let alone taking a backup.
    if (confirmation !== RESTORE_CONFIRMATION) {
        await AuditLogService.record(userId, AuditAction.IMPORT, "Backup", undefined, {
            newData: { outcome: "refused", reason: "MISSING_CONFIRMATION" },
        });

        throw new AppError(
            status.BAD_REQUEST,
            `A restore deletes all current data. To confirm, send confirmation: "${RESTORE_CONFIRMATION}".`,
        );
    }

    let file: BackupFile;
    try {
        file = await parseAndValidate(buffer);
    } catch (error) {
        await AuditLogService.record(userId, AuditAction.IMPORT, "Backup", undefined, {
            newData: {
                outcome: "refused",
                reason: error instanceof AppError ? error.message : "unreadable file",
            },
        });
        throw error;
    }

    const safetyBackup = await createBackup();

    prunePendingRestores();

    const token = crypto.randomUUID();
    const expiresAt = Date.now() + PENDING_RESTORE_TTL_MS;
    pendingRestores.set(token, { token, file, expiresAt, userId });

    return { token, expiresAt, safetyBackup, manifest: file.manifest };
};

/**
 * Step two: apply a previously validated restore.
 *
 * One interactive transaction — the spec requires that a restore either
 * completes or changes nothing.
 */
const confirmRestore = async (userId: string, token: string): Promise<RestoreSummary> => {
    prunePendingRestores();

    const pending = pendingRestores.get(token);

    // Same user, or not at all: the token is a capability to destroy this
    // shop's data, and it belongs to whoever passed the confirmation.
    if (!pending || pending.userId !== userId) {
        await AuditLogService.record(userId, AuditAction.IMPORT, "Backup", undefined, {
            newData: { outcome: "refused", reason: "UNKNOWN_OR_EXPIRED_TOKEN" },
        });

        throw new AppError(
            status.BAD_REQUEST,
            "This restore is no longer pending — it may have expired, already been applied, or the server may have restarted. Nothing was changed; submit the backup file again.",
        );
    }

    // Consumed up front, so a retry of a half-finished confirm cannot replay it.
    pendingRestores.delete(token);

    const { writeOrder, deleteOrder, selfReferencing } = getTableOrder();
    const selfReferencingColumns = new Map(selfReferencing.map((entry) => [entry.model, entry.columns]));

    const summaryTables: RestoreSummary["tables"] = [];

    try {
        await prisma.$transaction(
            async (tx) => {
                const client = tx as unknown as Record<
                    string,
                    {
                        deleteMany: (args?: unknown) => Promise<unknown>;
                        createMany: (args: unknown) => Promise<unknown>;
                        update: (args: unknown) => Promise<unknown>;
                    }
                >;

                // Delete order is the exact reverse of write order, so a row is
                // never removed while something still points at it.
                for (const modelName of deleteOrder) {
                    await client[clientKeyOf(modelName)].deleteMany();
                }

                for (const modelName of writeOrder) {
                    const rows = decodeRows(modelName, pending.file.data[modelName] ?? []);
                    if (rows.length === 0) {
                        summaryTables.push({ name: modelName, rowCount: 0 });
                        continue;
                    }

                    const selfColumns = selfReferencingColumns.get(modelName);

                    if (selfColumns && selfColumns.length > 0) {
                        // Table order cannot help here — a row can point at
                        // another row of its OWN table (Category.parentId), and
                        // the parent may come later in the list. Insert with the
                        // self-reference cleared, then restore it once every row
                        // of this table exists.
                        const deferred: { id: unknown; values: Record<string, unknown> }[] = [];

                        const flattened = rows.map((row) => {
                            const copy = { ...row };
                            const values: Record<string, unknown> = {};

                            for (const column of selfColumns) {
                                if (copy[column] != null) {
                                    values[column] = copy[column];
                                    copy[column] = null;
                                }
                            }

                            if (Object.keys(values).length > 0) {
                                deferred.push({ id: row.id, values });
                            }
                            return copy;
                        });

                        await client[clientKeyOf(modelName)].createMany({ data: flattened });

                        for (const { id, values } of deferred) {
                            await client[clientKeyOf(modelName)].update({ where: { id }, data: values });
                        }
                    } else {
                        // One statement per table rather than one per row: the
                        // difference between a restore that fits in a
                        // transaction and one that does not.
                        await client[clientKeyOf(modelName)].createMany({ data: rows });
                    }

                    summaryTables.push({ name: modelName, rowCount: rows.length });
                }
            },
            {
                /*
                 * The only transaction in this codebase with an explicit
                 * timeout — the other 27 use Prisma's 5s default. A restore
                 * deletes and rewrites ~56 tables over a pooled Neon
                 * connection and cannot finish in five seconds, so the default
                 * would abort every restore partway (and roll it back, safely,
                 * but always). See design Decision 3.
                 */
                timeout: 5 * 60 * 1000,
                maxWait: 30 * 1000,
            },
        );
    } catch (error) {
        // The transaction rolled back, so the shop is untouched. Recorded
        // because a failed restore is exactly the kind of event an audit log
        // exists for — and AuditLog is excluded from the restore, so this
        // entry survives whatever the restore did or did not do.
        await AuditLogService.record(userId, AuditAction.IMPORT, "Backup", undefined, {
            newData: {
                outcome: "failed",
                reason: error instanceof Error ? error.message : String(error),
                restoredFrom: pending.file.manifest,
            },
        });

        throw new AppError(
            status.INTERNAL_SERVER_ERROR,
            `The restore failed and was rolled back — your data is exactly as it was before the attempt. Cause: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }

    const summary: RestoreSummary = {
        tables: summaryTables,
        totalRows: summaryTables.reduce((total, table) => total + table.rowCount, 0),
        restoredFrom: pending.file.manifest,
    };

    await AuditLogService.record(userId, AuditAction.IMPORT, "Backup", undefined, {
        newData: { outcome: "succeeded", ...summary },
    });

    return summary;
};

export const BackupService = {
    createBackup,
    exportBackup,
    parseAndValidate,
    prepareRestore,
    confirmRestore,
    getSchemaVersion,
    RESTORE_CONFIRMATION,
};

/** Test seam: clears pending restores between verification runs. */
export const __clearPendingRestores = () => pendingRestores.clear();
