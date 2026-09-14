/**
 * Runs the environment→database credential import at most once per process,
 * lazily, on the first read that would be wrong without it.
 *
 * WHY THIS IS NOT JUST A BOOT STEP. `seedSuperAdmin()` is called from
 * `server.ts`, which is the LOCAL entrypoint. The deployed server is `api.ts`,
 * which exports the Express app for Vercel and never listens — so nothing in
 * that bootstrap path runs in production at all. An import wired only to the
 * boot sequence would work perfectly on every developer's machine and silently
 * never run where it actually matters, and the symptom would be a shop that
 * upgraded and then stopped dispatching, with credentials sitting unread in its
 * environment.
 *
 * So the import is triggered from the read path instead: the first time anything
 * resolves a courier's credentials, this runs first. `seedSuperAdmin` keeps
 * calling `importEnvCredentials` directly as well, which is harmless — the
 * import fills only absent rows, so running it twice does nothing the second
 * time.
 *
 * ONE IN-FLIGHT RUN, NOT ONE PER CALLER. The promise is memoised rather than a
 * boolean being flipped, because a cold serverless function can take several
 * concurrent requests before any of them finishes. A boolean would let all of
 * them past the guard at once and race on the same `(provider, kind)` upsert.
 *
 * A FAILED IMPORT DOES NOT POISON THE PROCESS. On failure the memo is cleared so
 * the next call retries. The alternative — caching a rejected promise — would
 * turn one transient database blip at cold start into an integration that
 * reports itself unconfigured until the function is recycled.
 *
 * See openspec/changes/rename-courier-setting-to-integrations, design.md
 * Migration Plan.
 */
import { IntegrationService } from "./integration.service";

let inFlight: Promise<void> | null = null;

/**
 * Ensures the one-time import has happened in this process.
 *
 * Never throws. An import that fails must not fail the call that triggered it:
 * the caller is trying to resolve credentials, and the right outcome for a
 * failed import is "the credentials that are already in the database", not an
 * error page. A shop with nothing to import — every new one — takes a single
 * cheap query and then this is a no-op forever.
 */
export const ensureEnvCredentialsImported = async (): Promise<void> => {
    if (inFlight) return inFlight;

    inFlight = IntegrationService.importEnvCredentials()
        .then(() => undefined)
        .catch((error) => {
            console.error(
                "[integration] Could not import environment credentials into encrypted storage. Any credential already stored is unaffected; this will be retried on the next credential read.",
                error,
            );
            // Cleared so the next caller retries rather than inheriting this
            // failure for the life of the process.
            inFlight = null;
        });

    return inFlight;
};
