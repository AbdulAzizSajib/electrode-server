import { envVars } from "../config/env";

/**
 * Tells the storefront to drop a cached tag, so a merchant's settings save is
 * visible on the next page load rather than whenever the storefront's own
 * revalidate window happens to elapse.
 *
 * Three deliberate properties:
 *
 *  1. **It never fails a mutation.** The merchant's save has already committed
 *     by the time this runs; a storefront that is down, slow, or not deployed
 *     must not turn a successful save into an error. Every failure is logged
 *     and swallowed, and the worst outcome is the cache expiring on its own —
 *     exactly the behaviour that existed before this function.
 *
 *  2. **It is not awaited by the request.** Callers fire and forget, so the
 *     admin's PATCH does not wait on a second network hop.
 *
 *  3. **It is a no-op when unconfigured.** Without a secret there is nothing to
 *     authenticate with, so it returns quietly rather than sending an
 *     unauthenticated request that would only ever 401.
 */

/** Matches the storefront's STORE_SETTINGS_CACHE_TAG. */
export const STORE_SETTINGS_TAG = "store-settings";

/** Short: this is a background hint, not something worth holding a socket for. */
const TIMEOUT_MS = 3000;

/** So an unconfigured deployment says so once, not on every settings save. */
let warnedUnconfigured = false;

export const revalidateStorefront = (tag: string): void => {
    const secret = envVars.STOREFRONT_REVALIDATE_SECRET;

    /*
     * STOREFRONT_URL first, FRONTEND_URL as the fallback. They are usually the
     * same origin, but not always — FRONTEND_URL also backs auth callbacks and
     * email links, so a deployment whose storefront is served from a different
     * host or port can point this one at it without disturbing those.
     */
    const base = envVars.STOREFRONT_URL || envVars.FRONTEND_URL;

    if (!secret || !base) {
        /*
         * Said out loud rather than returning silently. Without this, a missing
         * env var presents as "the admin saves but the site does not update",
         * which reads as a broken feature rather than a configuration gap —
         * exactly the confusion this whole mechanism exists to remove.
         *
         * Not fatal: the storefront still refreshes on its own short interval,
         * so an unconfigured install is slow, not wrong.
         */
        if (!warnedUnconfigured) {
            warnedUnconfigured = true;
            console.warn(
                "[revalidateStorefront] STOREFRONT_REVALIDATE_SECRET is not set — " +
                    "settings saves will not clear the storefront cache immediately. " +
                    "The storefront will still pick changes up on its own refresh interval.",
            );
        }
        return;
    }

    void (async () => {
        try {
            const response = await fetch(
                `${base.replace(/\/$/, "")}/api/revalidate`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-revalidate-secret": secret,
                    },
                    body: JSON.stringify({ tag }),
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                },
            );

            if (!response.ok) {
                // Logged rather than thrown: a stale storefront cache is a
                // cosmetic delay, and the save it followed already succeeded.
                console.warn(
                    `Storefront revalidation for "${tag}" returned ${response.status}`,
                );
            }
        } catch (error) {
            console.warn(
                `Storefront revalidation for "${tag}" failed:`,
                error instanceof Error ? error.message : error,
            );
        }
    })();
};
