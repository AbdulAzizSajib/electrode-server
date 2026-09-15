import { v2 as cloudinary } from "cloudinary";
// Importing for the side effect: the module calls `cloudinary.config(...)` at
// import time with the credentials from `envVars`. Without this the Admin API
// call below would go out unauthenticated.
import "../../config/cloudinary.config";
import { prisma } from "../../lib/prisma";
import { IMediaUsage, IStorageSize, IStorageUsage } from "./storage.interface";

/**
 * Where the merchant's data actually sits, reported from the two systems that
 * hold it — see `openspec/changes/add-storage-usage-panel`.
 *
 * Read-only and derived; nothing here is stored. Both reads are live, which is
 * the point: a cached figure would be wrong precisely when someone is watching
 * it move.
 */

/** Bytes → "15 MB". Binary units, matching what `pg_size_pretty` and Cloudinary both report. */
const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    if (bytes < 1024) return `${bytes} B`;

    const units = ["kB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }

    // One decimal below 10 ("9.4 MB"), none above ("471 MB") — enough precision
    // to see movement without implying more than the source measures.
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

const toSize = (bytes: number): IStorageSize => ({ bytes, label: formatBytes(bytes) });

/**
 * Total on-disk size of the database, indexes included.
 *
 * `pg_database_size` rather than summing `pg_total_relation_size` per table:
 * the per-table sum omits the catalog and free space, so it reads lower than
 * what the host actually bills for. This is a raw query because Prisma has no
 * API for it at all.
 */
const readDatabaseUsage = async () => {
    const rows = await prisma.$queryRaw<{ bytes: bigint }[]>`
        SELECT pg_database_size(current_database()) AS bytes
    `;

    const bytes = rows[0]?.bytes;
    if (bytes === undefined) throw new Error("Database size query returned no rows");

    // `bigint` from Postgres — Number is exact well past any plausible database
    // size (2^53 bytes is ~9 petabytes), so the narrowing is safe here.
    return { size: toSize(Number(bytes)), reachable: true as const };
};

/**
 * Cloudinary's own account usage.
 *
 * Its Admin API is rate-limited (500/hour on the free tier), which is the
 * reason this endpoint is admin-gated and not something the storefront calls.
 */
const readMediaUsage = async (): Promise<IMediaUsage> => {
    const usage = await cloudinary.api.usage();

    const credits = usage.credits
        ? {
              used: usage.credits.usage ?? 0,
              limit: usage.credits.limit ?? 0,
              percentUsed: usage.credits.used_percent ?? 0,
          }
        : null;

    return {
        plan: usage.plan ?? "Unknown",
        storage: toSize(usage.storage?.usage ?? 0),
        bandwidth: toSize(usage.bandwidth?.usage ?? 0),
        assets: usage.resources ?? 0,
        credits,
    };
};

/**
 * Both halves are read concurrently and each failure is captured rather than
 * thrown.
 *
 * A Cloudinary outage, an expired API key, or a rate-limit response must not
 * take the database figure down with it — the page exists to answer "how much
 * am I using", and half an answer beats an error card. The UI renders a missing
 * half as explicitly unavailable, never as zero.
 */
const getStorageUsage = async (): Promise<IStorageUsage> => {
    const [database, media] = await Promise.allSettled([readDatabaseUsage(), readMediaUsage()]);

    const reason = (result: PromiseRejectedResult): string => {
        const error = result.reason as { error?: { message?: string }; message?: string };
        // Cloudinary nests its message under `error.message`; everything else
        // is a normal Error.
        return error?.error?.message ?? error?.message ?? "Unknown error";
    };

    return {
        database: database.status === "fulfilled" ? database.value : null,
        databaseError: database.status === "rejected" ? reason(database) : null,
        media: media.status === "fulfilled" ? media.value : null,
        mediaError: media.status === "rejected" ? reason(media) : null,
    };
};

export const StorageService = {
    getStorageUsage,
    // Exported for the verify script — the formatting is the part with edge cases.
    formatBytes,
};
