/** Bytes, plus a pre-formatted label so both frontends render the same string. */
export interface IStorageSize {
    bytes: number;
    /** e.g. "15 MB" — formatted server-side so admin and storefront cannot disagree. */
    label: string;
}

export interface IDatabaseUsage {
    /** Total on-disk size of the database, indexes included. */
    size: IStorageSize;
    /**
     * Deliberately no `limit` or `percentUsed`.
     *
     * The hosting provider's quota is not readable from inside Postgres, and a
     * limit carried in an env var goes stale the moment a plan changes — which
     * is exactly when an accurate number matters. A wrong "23% used" is worse
     * than no percentage at all: it reassures instead of informing.
     */
    reachable: true;
}

/** What Cloudinary's Admin API reports back, narrowed to what the panel shows. */
export interface IMediaUsage {
    plan: string;
    storage: IStorageSize;
    /** Billing-period bandwidth. Cloudinary resets this monthly. */
    bandwidth: IStorageSize;
    /** Number of stored assets (images and video). */
    assets: number;
    /**
     * Cloudinary's own credit accounting, which is what its free tier is
     * actually metered on — storage and bandwidth both draw from it. Present
     * only on plans that report it, so the UI must tolerate null.
     */
    credits: { used: number; limit: number; percentUsed: number } | null;
}

/**
 * Either half can fail independently, so each carries its own error rather than
 * failing the whole response: a Cloudinary outage must not hide the database
 * figure, and vice versa. `null` means "could not read", which the UI shows as
 * an explicit unavailable state — never as zero.
 */
export interface IStorageUsage {
    database: IDatabaseUsage | null;
    databaseError: string | null;
    media: IMediaUsage | null;
    mediaError: string | null;
}
