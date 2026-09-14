/**
 * Reading and writing integration configuration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: A STORED SECRET NEVER LEAVES.
 *
 * `listIntegrations` returns presence booleans and a four-character hint. There
 * is no function here that returns a stored credential, and
 * `IIntegrationState` has no field one could be returned in. That is deliberate
 * friction: a "reveal" endpoint would have to change the interface first, at
 * which point whoever adds it has to argue with this comment.
 *
 * The reasoning is that a value the API can return is a value an XSS, a proxy
 * log, or a screenshotted devtools panel can capture. The merchant does not need
 * it back — they need to know WHICH key is stored (the hint answers that) and to
 * be able to replace it (the write path answers that).
 *
 * The one exception is `generateWebhookSecret`, which returns its secret exactly
 * once, on the response to the explicit action that created it. It has to: the
 * merchant must paste it into the courier's panel. Returning it once from a
 * POST-like action is a far narrower surface than storing it somewhere any
 * subsequent read could reach.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENV IS A FALLBACK, NEVER AN OVERRIDE.
 *
 * `importEnvCredentials` fills only kinds that have NO row. It cannot overwrite
 * a merchant-entered value, because reversing that would silently revert a key
 * the merchant had just rotated in the panel back to whatever the deployment was
 * built with — and they would discover it at dispatch, on real parcels.
 *
 * See openspec/changes/rename-courier-setting-to-integrations, design.md
 * Decisions 1, 5 and 6.
 */
import { randomBytes } from "node:crypto";
import status from "http-status";
import { AuditAction } from "../../../generated/prisma/client";
import { envVars } from "../../config/env";
import AppError from "../../errorHelpers/AppError";
import { decryptSecret, encryptSecret, hintFor, isEncryptionConfigured } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";
import { AuditLogService } from "../audit-log/audit-log.service";
import { CredentialKind, INTEGRATIONS, IntegrationId, findIntegration } from "./integration.constant";
import {
    ICredentialState,
    IGeneratedWebhookSecret,
    IIntegrationDescriptor,
    IIntegrationState,
} from "./integration.interface";

/** Entity name for the audit trail. */
const AUDIT_ENTITY = "Integration";

/**
 * The `lastFour` to store for a secret, or null when none may be shown.
 *
 * Defers to `hintFor` so the rule lives in exactly one place — including the
 * part that is easy to lose: a secret of eight characters or fewer is masked
 * ENTIRELY, because showing four of six characters is not a hint, it is most of
 * the secret. Writing `value.slice(-4)` at each call site would silently drop
 * that.
 */
const lastFourFor = (value: string): string | null => {
    const hint = hintFor(value);
    return hint === "••••" ? null : hint.replace(/^•+/, "");
};

/**
 * The declaration for an id, or a 404.
 *
 * Throws rather than returning undefined: every caller reaches this with an id
 * from a URL, and a route that silently did nothing for an unknown integration
 * would be indistinguishable from one that worked.
 */
const requireDescriptor = (id: string): IIntegrationDescriptor => {
    const descriptor = findIntegration(id);

    if (!descriptor) {
        throw new AppError(status.NOT_FOUND, `No integration named "${id}".`);
    }

    return descriptor;
};

/**
 * The callback URL for an integration that has a publicId.
 *
 * Built from `BETTER_AUTH_URL`, which is this server's own origin — the URL has
 * to be reachable by the courier, so it cannot be derived from the request (an
 * admin on localhost would generate a localhost callback and paste it into a
 * production courier panel, where it would silently never fire).
 */
const callbackUrlFor = (provider: string, publicId: string | null): string | null => {
    if (!publicId) return null;

    const origin = envVars.BETTER_AUTH_URL.replace(/\/+$/, "");
    return `${origin}/api/v1/webhooks/${provider}/${publicId}`;
};

/**
 * One integration's state, assembled from its declaration plus its rows.
 *
 * `configured` and `readable` are separate because they need different fixes and
 * look identical otherwise. A missing credential is fixed by typing it in; an
 * undecryptable one is fixed by restoring the encryption key, and typing it in
 * again under the wrong key would just produce another unreadable row.
 */
const toState = (
    descriptor: IIntegrationDescriptor,
    row: { enabled: boolean; publicId: string | null } | undefined,
    credentialRows: { kind: string; value: string; lastFour: string | null }[],
): IIntegrationState => {
    const byKind = new Map(credentialRows.map((credential) => [credential.kind, credential]));

    let anyUnreadable = false;

    const credentials: ICredentialState[] = descriptor.credentials.map((declared) => {
        const stored = byKind.get(declared.kind);

        if (!stored) {
            return { ...declared, present: false, hint: null };
        }

        /*
         * A non-secret credential returns its actual value — that is what
         * `secret: false` means, and it is why the field is called `hint` rather
         * than `masked`. A secret one returns `lastFour` if we recorded it, and
         * otherwise the generic mask; it is never decrypted just to build a
         * hint, because decrypting a value in order to display part of it is how
         * a "reveal" feature gets added by accident.
         */
        if (!declared.secret) {
            return { ...declared, present: true, hint: decryptSecret(stored.value) };
        }

        // Readability is checked here because this is the only place that
        // already knows which rows exist. A row that will not decrypt is
        // present-but-useless, and the merchant needs to be told which.
        if (decryptSecret(stored.value) === null) anyUnreadable = true;

        /*
         * Formatted from the stored `lastFour`, never by decrypting the value to
         * take a slice of it — decrypting in order to display part of something
         * is how a "reveal" feature gets added by accident. The write path
         * already applied `hintFor`'s rule (including masking short secrets
         * entirely), so `lastFour` is absent precisely when nothing may be shown.
         */
        return {
            ...declared,
            present: true,
            hint: stored.lastFour ? `••••${stored.lastFour}` : "••••",
        };
    });

    const webhookRow = descriptor.webhook ? byKind.get(descriptor.webhook.kind) : undefined;

    return {
        id: descriptor.id,
        displayName: descriptor.displayName,
        description: descriptor.description,
        category: descriptor.category,
        // No row yet means never touched. Enabled by default so an imported
        // credential yields a working integration without a second step.
        enabled: row?.enabled ?? true,
        // An integration declaring no credentials is configured by definition —
        // MANUAL needs nothing, and reporting it unconfigured would show a
        // working setup as broken.
        configured: credentials.every((credential) => credential.present),
        readable: !anyUnreadable && isEncryptionConfigured(),
        credentials,
        ...(descriptor.webhook
            ? {
                  webhook: {
                      label: descriptor.webhook.label,
                      instructions: descriptor.webhook.instructions,
                      configured: Boolean(webhookRow),
                      callbackUrl: callbackUrlFor(descriptor.id, row?.publicId ?? null),
                  },
              }
            : {}),
    };
};

/**
 * Every integration and its current state.
 *
 * Two queries for the whole list rather than one pair per integration: the admin
 * renders all of them at once, and N+1 here would be N+1 on every page load of a
 * page that is mostly cards.
 */
const listIntegrations = async (): Promise<IIntegrationState[]> => {
    // So the first admin visit after an upgrade shows the imported credentials
    // as present, rather than showing an unconfigured courier that is in fact
    // dispatching fine.
    const { ensureEnvCredentialsImported } = await import("./integration.bootstrap");
    await ensureEnvCredentialsImported();

    const [rows, credentials] = await Promise.all([
        prisma.integration.findMany({ select: { provider: true, enabled: true, publicId: true } }),
        prisma.integrationCredential.findMany({
            select: { provider: true, kind: true, value: true, lastFour: true },
        }),
    ]);

    const rowByProvider = new Map(rows.map((row) => [row.provider, row]));

    const credentialsByProvider = new Map<string, typeof credentials>();
    for (const credential of credentials) {
        const existing = credentialsByProvider.get(credential.provider) ?? [];
        existing.push(credential);
        credentialsByProvider.set(credential.provider, existing);
    }

    return INTEGRATIONS.map((descriptor) =>
        toState(
            descriptor,
            rowByProvider.get(descriptor.id),
            credentialsByProvider.get(descriptor.id) ?? [],
        ),
    );
};

/** One integration's state. Same shape as a row of the listing. */
const getIntegration = async (id: string): Promise<IIntegrationState> => {
    const descriptor = requireDescriptor(id);

    const [row, credentials] = await Promise.all([
        prisma.integration.findUnique({
            where: { provider: id },
            select: { enabled: true, publicId: true },
        }),
        prisma.integrationCredential.findMany({
            where: { provider: id },
            select: { kind: true, value: true, lastFour: true },
        }),
    ]);

    return toState(descriptor, row ?? undefined, credentials);
};

/**
 * Ensures the `Integration` row exists.
 *
 * Every write path calls this first, because the credential table has a foreign
 * key to it and a merchant saving a credential for an integration nobody has
 * toggled yet is the normal first-use path, not an edge case.
 */
const ensureIntegrationRow = async (provider: string) =>
    prisma.integration.upsert({
        where: { provider },
        update: {},
        create: { provider },
        select: { provider: true, enabled: true, publicId: true },
    });

/**
 * Saves one or more credentials.
 *
 * Only the kinds present in `values` are touched — an omitted kind is left
 * exactly as it was. That is what lets the admin's credential form submit only
 * the fields the merchant actually filled in, rather than having to resend
 * secrets it does not have in order to avoid clearing them. Sending a blank
 * string is likewise ignored rather than treated as "clear", because a form that
 * clears a working API key when the merchant tabs past the field is a dispatch
 * outage.
 */
const updateCredentials = async (
    userId: string | undefined,
    provider: string,
    values: Record<string, string>,
): Promise<IIntegrationState> => {
    const descriptor = requireDescriptor(provider);

    if (!isEncryptionConfigured()) {
        throw new AppError(
            status.SERVICE_UNAVAILABLE,
            "Credentials cannot be stored because INTEGRATION_ENCRYPTION_KEY is missing or invalid on the server.",
        );
    }

    const declaredKinds = new Set(descriptor.credentials.map((credential) => credential.kind));

    /*
     * The webhook secret is a real credential kind but is NOT writable here: it
     * is generated by `generateWebhookSecret` precisely so the merchant cannot
     * choose it, a merchant-chosen webhook secret being a merchant-chosen
     * password. Refused separately from an unknown kind because the two need
     * different messages — "no such credential" would send someone looking for a
     * typo in a field name that is spelled correctly.
     */
    if (descriptor.webhook && descriptor.webhook.kind in values) {
        throw new AppError(
            status.BAD_REQUEST,
            `The ${descriptor.displayName} webhook secret is generated by the server and cannot be set by hand. Use the Generate button instead.`,
        );
    }

    // An undeclared kind is refused rather than stored. Storing it would create a
    // row nothing ever reads, which then shows up as a credential the merchant
    // believes is configured.
    const unknown = Object.keys(values).filter((kind) => !declaredKinds.has(kind));
    if (unknown.length > 0) {
        throw new AppError(
            status.BAD_REQUEST,
            `${descriptor.displayName} has no credential named ${unknown.map((kind) => `"${kind}"`).join(", ")}.`,
        );
    }

    await ensureIntegrationRow(provider);

    const written: string[] = [];

    for (const [kind, raw] of Object.entries(values)) {
        const value = raw.trim();

        // Blank means "not supplied", never "clear". See the doc comment.
        if (!value) continue;

        await prisma.integrationCredential.upsert({
            where: { provider_kind: { provider, kind } },
            update: { value: encryptSecret(value), lastFour: lastFourFor(value) },
            create: { provider, kind, value: encryptSecret(value), lastFour: lastFourFor(value) },
        });

        written.push(kind);
    }

    /*
     * The audit entry records WHICH credentials changed and never what they
     * became. A trail that logged the value would be a second place secrets
     * live, readable by anyone who can read the audit log — which is a strictly
     * larger group than those who can write the credential.
     */
    await AuditLogService.record(userId, AuditAction.UPDATE, AUDIT_ENTITY, provider, {
        newData: { credentialsUpdated: written },
    });

    return getIntegration(provider);
};

/**
 * Generates this integration's webhook secret, and its publicId if it has none.
 *
 * The secret is generated here rather than accepted from the merchant: a
 * merchant-chosen webhook secret is a merchant-chosen password, with the failure
 * mode that implies.
 *
 * Regeneration invalidates the previous secret IMMEDIATELY — there is no grace
 * period, because two valid tokens is a longer window in which the old one is
 * still useful to whoever might have it. The cost is a gap in notifications
 * until the merchant updates the courier's panel, which the scheduled
 * reconciliation sync then catches up; the admin warns about this at the moment
 * of regeneration.
 */
const generateWebhookSecret = async (
    userId: string | undefined,
    provider: string,
): Promise<IGeneratedWebhookSecret> => {
    const descriptor = requireDescriptor(provider);

    if (!descriptor.webhook) {
        throw new AppError(
            status.BAD_REQUEST,
            `${descriptor.displayName} does not receive webhooks, so it has no secret to generate.`,
        );
    }

    if (!isEncryptionConfigured()) {
        throw new AppError(
            status.SERVICE_UNAVAILABLE,
            "A webhook secret cannot be stored because INTEGRATION_ENCRYPTION_KEY is missing or invalid on the server.",
        );
    }

    const row = await ensureIntegrationRow(provider);

    // 32 bytes, hex — long enough that guessing is not a strategy, and free of
    // the `+/=` that some courier panels mangle in a form field.
    const secret = randomBytes(32).toString("hex");

    // Minted once and then stable. Regenerating the SECRET must not change the
    // URL, or every regeneration would require re-pasting the callback too.
    const publicId = row.publicId ?? randomBytes(16).toString("hex");

    await prisma.$transaction([
        prisma.integration.update({ where: { provider }, data: { publicId } }),
        prisma.integrationCredential.upsert({
            where: { provider_kind: { provider, kind: descriptor.webhook.kind } },
            update: { value: encryptSecret(secret), lastFour: lastFourFor(secret) },
            create: {
                provider,
                kind: descriptor.webhook.kind,
                value: encryptSecret(secret),
                lastFour: lastFourFor(secret),
            },
        }),
    ]);

    await AuditLogService.record(userId, AuditAction.UPDATE, AUDIT_ENTITY, provider, {
        newData: { webhookSecretRegenerated: true },
    });

    return {
        secret,
        callbackUrl: callbackUrlFor(provider, publicId) as string,
    };
};

/**
 * Turns an integration on or off, leaving its credentials in place.
 *
 * SWITCHING OFF THE SELECTED COURIER IS REFUSED. Dispatch reads
 * `StoreSetting.courierProvider` to decide where orders go and `enabled` to
 * decide whether that courier may be used; allowing the two to contradict each
 * other would leave a shop whose every dispatch fails, with nothing on the
 * Orders page explaining why. The merchant has to select a different courier
 * first — which is the same shape as the existing rule that a courier cannot be
 * switched away from while its parcels are in flight.
 *
 * Only the SELECTED courier is protected. Switching off an unselected one is
 * exactly what a merchant does when they stop using a courier, and it is safe:
 * nothing dispatches through it.
 */
const setEnabled = async (
    userId: string | undefined,
    provider: string,
    enabled: boolean,
): Promise<IIntegrationState> => {
    const descriptor = requireDescriptor(provider);

    if (!enabled && descriptor.category === "COURIER") {
        const setting = await prisma.storeSetting.findUnique({
            where: { id: "singleton" },
            select: { courierProvider: true },
        });

        if (setting?.courierProvider === provider) {
            throw new AppError(
                status.CONFLICT,
                `${descriptor.displayName} is the courier this shop dispatches through, so it cannot be switched off. Select a different courier first, then switch this one off.`,
            );
        }
    }

    await prisma.integration.upsert({
        where: { provider },
        update: { enabled },
        create: { provider, enabled },
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, AUDIT_ENTITY, provider, {
        newData: { enabled },
    });

    return getIntegration(provider);
};

/**
 * Resolves one integration's credentials for use by a caller that is about to
 * make a call with them.
 *
 * The ONLY function here that returns plaintext, and it is not reachable from
 * any route — it exists for the courier adapters, which need the actual key to
 * talk to the courier. Everything HTTP-facing goes through `listIntegrations`
 * and `getIntegration`, which cannot return a value.
 *
 * Returns `{}` rather than throwing when nothing is configured: the caller's job
 * is to report itself unconfigured and refuse, which produces a message naming
 * the missing configuration, rather than a stack trace.
 *
 * A kind that fails to decrypt is OMITTED rather than returned as null, so a
 * caller checking `if (creds.apiKey)` treats an unreadable credential exactly
 * like an absent one. Both mean "cannot dispatch", and distinguishing them at
 * every call site would be noise.
 */
const resolveCredentials = async (provider: string): Promise<Record<string, string>> => {
    /*
     * The lazy half of the env import. On Vercel nothing runs at boot, so the
     * first call that needs credentials is what triggers the one-time copy out
     * of the environment. Memoised per process and a no-op once done; see
     * `integration.bootstrap.ts`.
     *
     * Imported here rather than at module scope to keep the cycle broken —
     * bootstrap imports this service.
     */
    const { ensureEnvCredentialsImported } = await import("./integration.bootstrap");
    await ensureEnvCredentialsImported();

    const rows = await prisma.integrationCredential.findMany({
        where: { provider },
        select: { kind: true, value: true },
    });

    const resolved: Record<string, string> = {};

    for (const row of rows) {
        const value = decryptSecret(row.value);
        if (value !== null) resolved[row.kind] = value;
    }

    return resolved;
};

/** Whether this integration is switched on. Absent row means never configured,
 *  which defaults to enabled — see `toState`. */
const isEnabled = async (provider: string): Promise<boolean> => {
    const row = await prisma.integration.findUnique({
        where: { provider },
        select: { enabled: true },
    });

    return row?.enabled ?? true;
};

/** The integration a webhook publicId belongs to, or null. Used by the webhook
 *  route, which must attribute a notification before authenticating it. */
const findByPublicId = async (publicId: string): Promise<string | null> => {
    const row = await prisma.integration.findUnique({
        where: { publicId },
        select: { provider: true },
    });

    return row?.provider ?? null;
};

/**
 * Copies credentials out of the environment into encrypted storage, once.
 *
 * FILLS ONLY WHAT IS ABSENT. Env can supply a credential nobody has entered; it
 * can never replace one that exists. The inverse would mean a merchant who
 * rotated a key in the panel gets silently reverted to the deployment's old one
 * on the next boot, and discovers it at dispatch.
 *
 * Idempotent by construction, so it is safe to call on every boot and safe to
 * call lazily — which matters because `seedSuperAdmin` runs only from
 * `server.ts` and never on Vercel, where `api.ts` exports the app without ever
 * listening. An import that only ran at boot would work locally and silently
 * never run in production, which is the worst of both.
 */
const importEnvCredentials = async (): Promise<{ imported: string[] }> => {
    if (!isEncryptionConfigured()) return { imported: [] };

    const fromEnv: { provider: string; kind: string; value?: string }[] = [
        {
            provider: IntegrationId.STEADFAST,
            kind: CredentialKind.API_KEY,
            value: envVars.STEADFAST_API_KEY,
        },
        {
            provider: IntegrationId.STEADFAST,
            kind: CredentialKind.SECRET_KEY,
            value: envVars.STEADFAST_SECRET_KEY,
        },
        {
            provider: IntegrationId.STEADFAST,
            kind: CredentialKind.WEBHOOK_TOKEN,
            value: envVars.STEADFAST_WEBHOOK_TOKEN,
        },
    ];

    const present = fromEnv.filter((entry) => Boolean(entry.value?.trim()));
    if (present.length === 0) return { imported: [] };

    const imported: string[] = [];

    for (const entry of present) {
        const value = entry.value as string;

        await ensureIntegrationRow(entry.provider);

        const existing = await prisma.integrationCredential.findUnique({
            where: { provider_kind: { provider: entry.provider, kind: entry.kind } },
            select: { id: true },
        });

        // The whole safety property, in one branch: a row that exists is left
        // alone, whatever the environment says.
        if (existing) continue;

        await prisma.integrationCredential.create({
            data: {
                provider: entry.provider,
                kind: entry.kind,
                value: encryptSecret(value),
                lastFour: lastFourFor(value),
            },
        });

        imported.push(`${entry.provider}.${entry.kind}`);
    }

    if (imported.length > 0) {
        console.log(
            `[integration] Imported ${imported.length} credential(s) from the environment into encrypted storage: ${imported.join(", ")}. These can now be managed from admin UI → Integrations.`,
        );
    }

    return { imported };
};

export const IntegrationService = {
    listIntegrations,
    getIntegration,
    updateCredentials,
    generateWebhookSecret,
    setEnabled,
    resolveCredentials,
    isEnabled,
    findByPublicId,
    importEnvCredentials,
};
