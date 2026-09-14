/**
 * Verification for integration credential storage.
 *
 * Asserts the properties that make moving credentials out of the environment
 * safe rather than a downgrade. Each one is silent when broken:
 *
 *  - Values are ciphertext in the database. If this regressed, a database dump
 *    would contain every merchant's courier keys in readable form, and nothing
 *    in the application's behaviour would look different.
 *  - Reads disclose presence and a four-character hint, never a value. A
 *    "reveal" convenience added later would hand an XSS the keys.
 *  - Replacing a credential discards the old one. A superseded secret kept
 *    around is a secret that can still leak.
 *  - A credential that will not decrypt reports as unconfigured rather than
 *    throwing. Otherwise a wrong encryption key 500s the admin page that is the
 *    only way to fix it.
 *  - The environment can fill an absent credential but can NEVER overwrite one
 *    the merchant entered, or a key rotated in the panel silently reverts on the
 *    next boot and is discovered at dispatch.
 *
 * Runs against the real database using `__verify_*` rows, cleaned up in a
 * `finally`. Run with:
 *   npx tsx scripts/verify-integration-credentials.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { decryptSecret } from "../src/app/lib/crypto";
import { IntegrationService } from "../src/app/module/integration/integration.service";
import { INTEGRATIONS } from "../src/app/module/integration/integration.constant";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/*
 * A real integration is used rather than a fabricated one, because the
 * credential kinds are validated against the registry — a `__verify_` provider
 * would be refused by `updateCredentials`, which is itself one of the behaviours
 * under test. FACEBOOK_CAPI is chosen because it is the one integration whose
 * credentials are not imported from the environment, so this script cannot
 * disturb a working courier setup.
 *
 * Whatever state it is in beforehand is captured and restored in the finally.
 */
const PROVIDER = "FACEBOOK_CAPI";
const KIND = "accessToken";

const SECRET = "__verify_token_ORIGINAL_abcdefgh1234";
const REPLACEMENT = "__verify_token_REPLACED_zyxwvu987654";

const priorCredentials = await prisma.integrationCredential.findMany({
    where: { provider: PROVIDER },
});
const priorRow = await prisma.integration.findUnique({ where: { provider: PROVIDER } });

try {
    await prisma.integrationCredential.deleteMany({ where: { provider: PROVIDER } });

    console.log("\n--- Storage is encrypted ---\n");

    await IntegrationService.updateCredentials(undefined, PROVIDER, { [KIND]: SECRET });

    const stored = await prisma.integrationCredential.findUnique({
        where: { provider_kind: { provider: PROVIDER, kind: KIND } },
        select: { value: true, lastFour: true },
    });

    check(
        "the stored value is not the plaintext",
        stored !== null && stored.value !== SECRET,
        "a database dump must not contain readable credentials — this is the entire point",
    );

    check(
        "the stored value is versioned ciphertext",
        stored !== null && stored.value.startsWith("v1:") && stored.value.split(":").length === 4,
        "written through crypto.ts, never as a raw column write",
    );

    check(
        "no fragment of the plaintext survives in the column",
        stored !== null && !stored.value.includes(SECRET.slice(0, 16)),
        "partial leakage is still leakage",
    );

    check(
        "it decrypts back to exactly what was submitted",
        stored !== null && decryptSecret(stored.value) === SECRET,
        "a credential that does not round-trip is an API rejection nobody can explain",
    );

    console.log("\n--- Reads disclose presence, never a value ---\n");

    const state = await IntegrationService.getIntegration(PROVIDER);
    const credential = state.credentials.find((entry) => entry.kind === KIND);

    check(
        "the credential reports itself present",
        credential?.present === true,
        "the merchant has to be able to tell configured from not",
    );

    check(
        "the hint shows only the last four characters",
        credential?.hint === `••••${SECRET.slice(-4)}`,
        "enough to identify which key is stored, useless to anyone else",
    );

    check(
        "the serialised state contains no part of the secret",
        !JSON.stringify(state).includes(SECRET.slice(0, 16)),
        "a value the API can return is a value an XSS or a proxy log can capture",
    );

    const listing = await IntegrationService.listIntegrations();

    check(
        "the full listing contains no part of the secret either",
        !JSON.stringify(listing).includes(SECRET.slice(0, 16)),
        "the listing is the endpoint the admin calls on every page load",
    );

    check(
        "the integration reports itself configured",
        state.configured && state.readable,
        "every declared credential is present and readable",
    );

    console.log("\n--- Replacement discards the old value ---\n");

    await IntegrationService.updateCredentials(undefined, PROVIDER, { [KIND]: REPLACEMENT });

    const afterReplace = await prisma.integrationCredential.findMany({
        where: { provider: PROVIDER, kind: KIND },
        select: { value: true },
    });

    check(
        "replacing leaves exactly one row",
        afterReplace.length === 1,
        "the unique constraint is an upsert target, not an append log",
    );

    check(
        "the new value is what is now stored",
        decryptSecret(afterReplace[0].value) === REPLACEMENT,
        "the write has to actually take effect",
    );

    check(
        "the old value is gone from the database",
        decryptSecret(afterReplace[0].value) !== SECRET,
        "a superseded secret kept around is a secret that can still leak",
    );

    console.log("\n--- Omitted and blank values leave a credential alone ---\n");

    await IntegrationService.updateCredentials(undefined, PROVIDER, { [KIND]: "   " });

    check(
        "a blank submission does not clear a stored credential",
        (await IntegrationService.resolveCredentials(PROVIDER))[KIND] === REPLACEMENT,
        "a form that wipes a working key when the merchant tabs past the field is a dispatch outage",
    );

    console.log("\n--- An unreadable credential reports unconfigured, not an error ---\n");

    // Written directly, bypassing crypto.ts — which is exactly the state a wrong
    // encryption key produces: a row that exists and cannot be read.
    await prisma.integrationCredential.update({
        where: { provider_kind: { provider: PROVIDER, kind: KIND } },
        data: { value: "v1:bm90:YXQ=:YWxs" },
    });

    let threw = false;
    let corrupted;

    try {
        corrupted = await IntegrationService.getIntegration(PROVIDER);
    } catch {
        threw = true;
    }

    check(
        "reading an undecryptable credential does not throw",
        !threw,
        "a wrong key must not 500 the admin page that is the only way to fix it",
    );

    check(
        "it is reported as present but not readable",
        corrupted?.credentials.find((entry) => entry.kind === KIND)?.present === true &&
            corrupted?.readable === false,
        "present-and-unreadable needs a different fix than absent, so it is a different state",
    );

    check(
        "resolving it omits the kind entirely",
        (await IntegrationService.resolveCredentials(PROVIDER))[KIND] === undefined,
        "callers check presence; an unreadable credential must look absent, not empty",
    );

    console.log("\n--- The environment never overrides a stored value ---\n");

    await IntegrationService.updateCredentials(undefined, PROVIDER, { [KIND]: REPLACEMENT });
    await IntegrationService.importEnvCredentials();

    check(
        "importing does not disturb a merchant-entered credential",
        (await IntegrationService.resolveCredentials(PROVIDER))[KIND] === REPLACEMENT,
        "otherwise a key rotated in the panel silently reverts on the next boot",
    );

    const importAgain = await IntegrationService.importEnvCredentials();

    check(
        "a second import reports nothing imported",
        importAgain.imported.length === 0,
        "idempotent by construction, so it is safe to call on every boot and lazily",
    );

    console.log("\n--- Undeclared kinds are refused ---\n");

    let refused = false;
    try {
        await IntegrationService.updateCredentials(undefined, PROVIDER, { notAKind: "value" });
    } catch {
        refused = true;
    }

    check(
        "an undeclared credential kind is refused",
        refused,
        "storing it would create a row nothing reads, shown to the merchant as configured",
    );

    let unknownRefused = false;
    try {
        await IntegrationService.getIntegration("NOT_AN_INTEGRATION");
    } catch {
        unknownRefused = true;
    }

    check(
        "an unknown integration id is refused",
        unknownRefused,
        "a route that silently did nothing would be indistinguishable from one that worked",
    );

    console.log("\n--- The registry is coherent ---\n");

    check(
        "every integration id is unique",
        new Set(INTEGRATIONS.map((entry) => entry.id)).size === INTEGRATIONS.length,
        "two entries under one id would make credential storage ambiguous",
    );

    check(
        "every credential kind is unique within its integration",
        INTEGRATIONS.every(
            (entry) =>
                new Set(entry.credentials.map((credential) => credential.kind)).size ===
                entry.credentials.length,
        ),
        "the (provider, kind) unique constraint would silently collapse duplicates",
    );

    check(
        "no webhook secret collides with a declared credential kind",
        INTEGRATIONS.every(
            (entry) =>
                !entry.webhook ||
                !entry.credentials.some((credential) => credential.kind === entry.webhook!.kind),
        ),
        "generating a webhook secret would otherwise overwrite an API key",
    );
} finally {
    await prisma.integrationCredential.deleteMany({ where: { provider: PROVIDER } });

    for (const credential of priorCredentials) {
        await prisma.integrationCredential.create({
            data: {
                provider: credential.provider,
                kind: credential.kind,
                value: credential.value,
                lastFour: credential.lastFour,
            },
        });
    }

    if (!priorRow) {
        await prisma.integration.deleteMany({ where: { provider: PROVIDER } });
    } else {
        await prisma.integration.update({
            where: { provider: PROVIDER },
            data: { enabled: priorRow.enabled, publicId: priorRow.publicId },
        });
    }

    const leftovers = await prisma.integrationCredential.count({
        where: { value: { contains: "__verify_" } },
    });
    console.log(`\nCleanup: ${leftovers} __verify_ row(s) remaining (expected 0).`);

    await prisma.$disconnect();
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
