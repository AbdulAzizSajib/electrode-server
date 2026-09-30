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

/** Bytes → "15 MB". Binary units, matching what Cloudinary reports. */
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
 * AN ESTIMATE, unlike the `pg_database_size` this replaces. MySQL has no
 * equivalent function, so the figure is summed out of InnoDB's own statistics
 * in `information_schema`. Those are sampled rather than exact and lag writes,
 * so the number can differ from what the host bills for — and it omits free
 * space held inside the tablespace. It is close enough to answer the only
 * question the widget is asked ("am I near my quota?") and must not be used
 * for anything that needs the real figure.
 *
 * Scoped to DATABASE(), so it reports this application's schema rather than
 * every schema on a shared server - which is also all the grant allows.
 */
const readDatabaseUsage = async () => {
    const rows = await prisma.$queryRaw<{ bytes: number | bigint | null }[]>`
        SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes
        FROM information_schema.TABLES
        WHERE table_schema = DATABASE()
    `;

    const bytes = rows[0]?.bytes;
    if (bytes === undefined) throw new Error("Database size query returned no rows");

    // Number is exact well past any plausible database size (2^53 bytes is
    // ~9 petabytes), so the narrowing is safe whether the driver hands back a
    // number or a bigint. A schema with no tables sums to NULL, which COALESCE
    // above has already turned into 0.
    return { size: toSize(Number(bytes ?? 0)), reachable: true as const };
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
