/**
 * Verification for courier credential resolution.
 *
 * Covers the properties that only appear once credentials live in the database
 * rather than the environment, each of which is silent when broken:
 *
 *  - A key saved in the admin panel takes effect on the NEXT call, with no
 *    restart. Caching anywhere in the chain would make "I changed the key and it
 *    still says unconfigured" a real support burden.
 *  - The environment can fill an absent credential but can never override a
 *    stored one, or a key rotated in the panel silently reverts.
 *  - A provider with no readable credentials reports itself unconfigured and the
 *    service refuses BEFORE any order is sent, rather than dispatching with a
 *    blank API key and getting a 401 that reads like a wrong key.
 *  - The webhook guard's expected token comes from storage, and an unreadable
 *    one is refused exactly like an absent one.
 *
 * Uses the real database, writes under `__verify_` values, and restores whatever
 * was there in a `finally`. Run with:
 *   npx tsx scripts/verify-courier-credentials.ts
 */
import { CourierProvider } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { resolveProvider } from "../src/app/module/courier/providers";
import { CourierService } from "../src/app/module/courier/courier.service";
import { IntegrationService } from "../src/app/module/integration/integration.service";
import {
    CredentialKind,
    IntegrationId,
} from "../src/app/module/integration/integration.constant";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const steadfast = resolveProvider(CourierProvider.STEADFAST);

const prior = await prisma.integrationCredential.findMany({
    where: { provider: IntegrationId.STEADFAST },
});
const priorRow = await prisma.integration.findUnique({
    where: { provider: IntegrationId.STEADFAST },
});

try {
    console.log("\n--- A stored credential is what gets used ---\n");

    await IntegrationService.updateCredentials(undefined, IntegrationId.STEADFAST, {
        [CredentialKind.API_KEY]: "__verify_key_FIRST",
        [CredentialKind.SECRET_KEY]: "__verify_secret_FIRST",
    });

    const first = await steadfast.resolveCredentials();

    check(
        "the provider resolves the stored credentials",
        first[CredentialKind.API_KEY] === "__verify_key_FIRST",
        "this is the whole point of moving them out of the environment",
    );

    check(
        "it reports itself configured",
        (await steadfast.isConfigured()) === true,
        "both declared credentials are present and readable",
    );

    console.log("\n--- A change takes effect with no restart ---\n");

    await IntegrationService.updateCredentials(undefined, IntegrationId.STEADFAST, {
        [CredentialKind.API_KEY]: "__verify_key_SECOND",
    });

    const second = await steadfast.resolveCredentials();

    check(
        "the next resolution returns the new value",
        second[CredentialKind.API_KEY] === "__verify_key_SECOND",
        "a cache anywhere here would strand the merchant on the old key until a redeploy",
    );

    check(
        "the credential it did not change is untouched",
        second[CredentialKind.SECRET_KEY] === "__verify_secret_FIRST",
        "saving one field must not clear the others",
    );

    console.log("\n--- The environment never overrides a stored credential ---\n");

    await IntegrationService.importEnvCredentials();

    check(
        "importing leaves the stored value in place",
        (await steadfast.resolveCredentials())[CredentialKind.API_KEY] === "__verify_key_SECOND",
        "otherwise the next boot reverts a key the merchant just rotated",
    );

    console.log("\n--- Missing credentials refuse before anything is sent ---\n");

    await prisma.integrationCredential.deleteMany({
        where: { provider: IntegrationId.STEADFAST },
    });

    check(
        "a provider with no credentials reports itself unconfigured",
        (await steadfast.isConfigured()) === false,
        "the admin renders this as 'not configured', which is the truth",
    );

    check(
        "resolving returns an empty set rather than throwing",
        Object.keys(await steadfast.resolveCredentials()).length === 0,
        "the caller's job is to refuse with a useful message, not to catch a stack trace",
    );

    let refusal = "";
    try {
        await CourierService.dispatchOrders(["__verify_nonexistent_order"], {
            userId: "__verify_user",
            role: "ADMIN",
            email: "verify@example.com",
        });
    } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
    }

    check(
        "dispatch is refused, naming the missing configuration",
        refusal.includes("not configured") && refusal.includes("Integrations"),
        `the message points at where to fix it — got: "${refusal}"`,
    );

    check(
        "the refusal mentions no credential value",
        !refusal.includes("__verify_"),
        "an error naming a secret is a secret in a log",
    );

    console.log("\n--- The webhook token comes from storage ---\n");

    check(
        "no stored token means no expected token",
        (await steadfast.webhookToken!()) === undefined,
        "the guard refuses on undefined, which is what an unconfigured webhook must do",
    );

    /*
     * Generated through the service, not written directly — a webhook secret is
     * deliberately not settable by hand, so this is also the only way to obtain
     * one. The generated value is returned exactly once, here.
     */
    const generated = await IntegrationService.generateWebhookSecret(
        undefined,
        IntegrationId.STEADFAST,
    );

    let handWritten = "";
    try {
        await IntegrationService.updateCredentials(undefined, IntegrationId.STEADFAST, {
            [CredentialKind.WEBHOOK_TOKEN]: "__verify_chosen_by_hand",
        });
    } catch (error) {
        handWritten = error instanceof Error ? error.message : String(error);
    }

    check(
        "a webhook secret cannot be set by hand",
        handWritten.includes("generated by the server"),
        "a merchant-chosen webhook secret is a merchant-chosen password",
    );

    check(
        "a stored token is what the guard will compare against",
        (await steadfast.webhookToken!()) === generated.secret,
        "the token the merchant generated is the one the courier must present",
    );

    check(
        "the callback URL carries an unguessable id",
        /\/api\/v1\/webhooks\/STEADFAST\/[0-9a-f]{32}$/.test(generated.callbackUrl),
        "the endpoint must not be enumerable, even though the bearer token is the real boundary",
    );

    check(
        "regenerating invalidates the previous secret",
        (await IntegrationService.generateWebhookSecret(undefined, IntegrationId.STEADFAST))
            .secret !== generated.secret,
        "two valid tokens is a longer window in which a leaked one still works",
    );

    check(
        "the provider reports its webhook configured",
        (await steadfast.isWebhookConfigured()) === true,
        "the admin shows this as ready, so it must reflect storage",
    );

    console.log("\n--- An unreadable token is refused like an absent one ---\n");

    // Written directly, bypassing crypto.ts — the state a wrong encryption key
    // produces: a row that exists and cannot be read.
    await prisma.integrationCredential.update({
        where: {
            provider_kind: {
                provider: IntegrationId.STEADFAST,
                kind: CredentialKind.WEBHOOK_TOKEN,
            },
        },
        data: { value: "v1:Y29ycnVwdA==:dGFtcGVyZWQ=:dW5yZWFkYWJsZQ==" },
    });

    check(
        "an undecryptable token resolves to undefined, not a garbage string",
        (await steadfast.webhookToken!()) === undefined,
        "comparing against garbage would refuse anyway, but silently and for the wrong reason",
    );

    check(
        "an undecryptable token reports the webhook unconfigured",
        (await steadfast.isWebhookConfigured()) === false,
        "the admin must say 'not configured' rather than showing a webhook that cannot work",
    );
} finally {
    await prisma.integrationCredential.deleteMany({
        where: { provider: IntegrationId.STEADFAST },
    });

    for (const credential of prior) {
        await prisma.integrationCredential.create({
            data: {
                provider: credential.provider,
                kind: credential.kind,
                value: credential.value,
                lastFour: credential.lastFour,
            },
        });
    }

    // Generating a webhook secret mints a publicId, so the row is restored too.
    if (priorRow) {
        await prisma.integration.update({
            where: { provider: IntegrationId.STEADFAST },
            data: { enabled: priorRow.enabled, publicId: priorRow.publicId },
        });
    }

    const leftovers = await prisma.integrationCredential.count({
        where: { lastFour: { contains: "IRST" } },
    });
    console.log(`\nCleanup: restored ${prior.length} credential(s), ${leftovers} __verify_ leftover(s).`);

    await prisma.$disconnect();
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
