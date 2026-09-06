import { type EncodedRow } from "./backup.serialize";

/**
 * The backup file's shape, and the results the service returns.
 *
 * See add-database-backup-restore design.md Decision 7 for why the file is
 * gzipped JSON rather than CSV.
 */

/**
 * The file layout's own version, independent of the database schema version.
 *
 * Bumped when the ENVELOPE changes — a new top-level field, a different
 * encoding — so a future application can refuse a file it would otherwise
 * misparse. It says nothing about which columns the tables have; that is
 * `schemaVersion` below.
 */
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
    /** See `BACKUP_FORMAT_VERSION`. */
    formatVersion: number;
    /** When the backup was taken, ISO 8601. */
    takenAt: string;
    /**
     * The latest applied migration at the time of the backup, from
     * `_prisma_migrations`. A restore refuses a file whose value differs from
     * the running application's — see design Decision 6.
     */
    schemaVersion: string;
    /** Every included table with its row count, in write order. */
    tables: { name: string; rowCount: number }[];
}

export interface BackupFile {
    manifest: BackupManifest;
    /** Rows per table, keyed by model name. Every table in the manifest appears here, including empty ones. */
    data: Record<string, EncodedRow[]>;
}

/** A produced backup, ready to be sent to the browser. */
export interface BackupArtifact {
    /** Gzipped JSON of a `BackupFile`. */
    content: Buffer;
    filename: string;
    manifest: BackupManifest;
}

/** What a restore reports back, per the spec's "A restore succeeds" scenario. */
export interface RestoreSummary {
    tables: { name: string; rowCount: number }[];
    totalRows: number;
    /** The manifest of the file that was applied. */
    restoredFrom: BackupManifest;
}

/**
 * A validated, not-yet-applied restore.
 *
 * Held between the two calls of the restore exchange (design Decision 4): the
 * first validates and takes the safety backup, the second applies it.
 */
export interface PendingRestore {
    token: string;
    file: BackupFile;
    /** When this pending restore stops being usable. */
    expiresAt: number;
    /** Who submitted it — the second call must be the same user. */
    userId: string;
}

/** Why a backup file was refused. Distinct cases, because "invalid file" tells an operator nothing. */
export type RestoreRefusalReason =
    | "NOT_A_BACKUP"
    | "CORRUPT"
    | "UNSUPPORTED_FORMAT_VERSION"
    | "SCHEMA_VERSION_MISMATCH"
    | "MISSING_CONFIRMATION"
    | "UNKNOWN_OR_EXPIRED_TOKEN";
