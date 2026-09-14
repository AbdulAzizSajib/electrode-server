/**
 * Verification for the enable/disable switch.
 *
 * This exists because the switch was, briefly, decorative: the card rendered it
 * and the server ignored it, so a merchant could switch a courier off and watch
 * orders keep dispatching through it. Every check below is a way that could
 * happen again without anything looking broken.
 *
 *  - A disabled courier REFUSES dispatch, and says it is switched off rather
 *    than "not configured" — the two have different fixes, and sending someone
 *    to add credentials that are already there wastes the one message they get.
 *  - Switching off the SELECTED courier is refused outright, because dispatch
 *    reads the selection and the flag separately and a shop whose every dispatch
 *    fails has nothing on its Orders page explaining why.
 *  - Disabling KEEPS the credentials, so switching back on needs no re-entry.
 *  - Reconciliation is deliberately NOT gated: parcels already in a courier's
 *    van still need their statuses read back, or an order sits in SHIPPED
 *    forever and the customer is never told it arrived.
 *
 * Writes under `__verify_` and restores in a `finally`. Run with:
 *   npx tsx scripts/verify-integration-enabled.ts
 */
import { CourierProvider } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { CourierService } from "../src/app/module/courier/courier.service";
import { IntegrationService } from "../src/app/module/integration/integration.service";
import { IntegrationId } from "../src/app/module/integration/integration.constant";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Runs a dispatch and returns the refusal message, or "" when it did not refuse. */
const dispatchRefusal = async (): Promise<string> => {
    try {
        await CourierService.dispatchOrders(["__verify_no_such_order"], {
            userId: "__verify_user",
            role: "ADMIN",
            email: "verify@example.com",
        });
        return "";
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
};

const priorSetting = await prisma.storeSetting.findUnique({
    where: { id: "singleton" },
    select: { courierProvider: true },
});
const priorSteadfast = await prisma.integration.findUnique({
    where: { provider: IntegrationId.STEADFAST },
});
const priorCredentials = await prisma.integrationCredential.findMany({
    where: { provider: IntegrationId.STEADFAST },
});

try {
    console.log("\n--- The selected courier cannot be switched off ---\n");

    await prisma.storeSetting.update({
        where: { id: "singleton" },
        data: { courierProvider: CourierProvider.STEADFAST },
    });

    let refusal = "";
    try {
        await IntegrationService.setEnabled(undefined, IntegrationId.STEADFAST, false);
    } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
    }

    check(
        "switching off the selected courier is refused",
        refusal.includes("dispatches through"),
        `otherwise every dispatch fails with nothing explaining why — got: "${refusal}"`,
    );

    check(
        "the refusal says what to do instead",
        refusal.toLowerCase().includes("select a different courier"),
        "a refusal that does not name the way out is a dead end",
    );

    check(
        "it is still enabled after the refusal",
        (await IntegrationService.isEnabled(IntegrationId.STEADFAST)) === true,
        "a refused write must change nothing",
    );

    console.log("\n--- An unselected courier can be switched off ---\n");

    // Selecting MANUAL frees STEADFAST to be switched off, which is exactly the
    // sequence the refusal above tells the merchant to follow.
    await prisma.storeSetting.update({
        where: { id: "singleton" },
        data: { courierProvider: CourierProvider.MANUAL },
    });

    await IntegrationService.setEnabled(undefined, IntegrationId.STEADFAST, false);

    check(
        "an unselected courier switches off",
        (await IntegrationService.isEnabled(IntegrationId.STEADFAST)) === false,
        "this is what a merchant does when they stop using a courier",
    );

    check(
        "its credentials survive being switched off",
        Object.keys(await IntegrationService.resolveCredentials(IntegrationId.STEADFAST)).length >
            0,
        "switching back on must not require re-entering keys from the courier's portal",
    );

    console.log("\n--- A disabled courier refuses to dispatch ---\n");

    // Select it again, bypassing the service guard, to reach the state the guard
    // prevents: selected AND disabled. A database edited by hand can produce it.
    await prisma.storeSetting.update({
        where: { id: "singleton" },
        data: { courierProvider: CourierProvider.STEADFAST },
    });

    const disabledRefusal = await dispatchRefusal();

    check(
        "dispatch is refused while the courier is switched off",
        disabledRefusal.includes("switched off"),
        `the whole point of the toggle — got: "${disabledRefusal}"`,
    );

    check(
        "the refusal does NOT claim it is unconfigured",
        !disabledRefusal.includes("not configured"),
        "its credentials are present; saying otherwise sends the merchant to fix the wrong thing",
    );

    check(
        "the refusal names where to switch it back on",
        disabledRefusal.includes("Integrations"),
        "the merchant has to be told which page to open",
    );

    console.log("\n--- Switching back on restores dispatch ---\n");

    await prisma.integration.update({
        where: { provider: IntegrationId.STEADFAST },
        data: { enabled: true },
    });

    const enabledRefusal = await dispatchRefusal();

    check(
        "the switched-off refusal is gone once re-enabled",
        !enabledRefusal.includes("switched off"),
        "no restart, no re-entry — the flag is read per operation",
    );

    console.log("\n--- The admin is told which couriers are off ---\n");

    await prisma.storeSetting.update({
        where: { id: "singleton" },
        data: { courierProvider: CourierProvider.MANUAL },
    });
    await IntegrationService.setEnabled(undefined, IntegrationId.STEADFAST, false);

    const config = await CourierService.getProviderConfiguration();
    const steadfast = config.providers.find((entry) => entry.id === CourierProvider.STEADFAST);

    check(
        "the config endpoint reports the disabled courier as such",
        steadfast?.enabled === false,
        "the picker uses this to refuse to offer it, rather than offering then failing",
    );

    check(
        "it still reports the credentials as present",
        steadfast?.credentialsConfigured === true,
        "disabled and unconfigured are different states and must stay distinguishable",
    );

    const manual = config.providers.find((entry) => entry.id === CourierProvider.MANUAL);

    check(
        "an untouched integration defaults to enabled",
        manual?.enabled === true,
        "a shop that has never opened this page must keep dispatching exactly as before",
    );
} finally {
    if (priorSteadfast) {
        await prisma.integration.update({
            where: { provider: IntegrationId.STEADFAST },
            data: { enabled: priorSteadfast.enabled, publicId: priorSteadfast.publicId },
        });
    }

    await prisma.integrationCredential.deleteMany({
        where: { provider: IntegrationId.STEADFAST },
    });
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

    if (priorSetting) {
        await prisma.storeSetting.update({
            where: { id: "singleton" },
            data: { courierProvider: priorSetting.courierProvider },
        });
    }

    const restored = await prisma.storeSetting.findUnique({
        where: { id: "singleton" },
        select: { courierProvider: true },
    });
    console.log(
        `\nCleanup: courier restored to ${restored?.courierProvider}, ${priorCredentials.length} credential(s) back.`,
    );

    await prisma.$disconnect();
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
