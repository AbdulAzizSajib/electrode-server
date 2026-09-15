/**
 * Verification for the two webhook callback URLs.
 *
 * The new `/webhooks/:provider/:publicId` path and the legacy
 * `/courier/webhook/:provider` path must authenticate IDENTICALLY. Two URLs into
 * one implementation is the design; two implementations would eventually mean
 * one of them authenticating worse, and the weaker one would be the one a
 * courier is actually pointed at.
 *
 * Covers, over real HTTP against a running server:
 *  - the new path accepts the stored token and applies the status;
 *  - the legacy path still does, so a portal already pointing at the old URL
 *    keeps working — a webhook that silently stops arriving is invisible until
 *    parcels appear stuck;
 *  - a wrong token, a missing token, an unknown publicId and a provider/publicId
 *    mismatch are all refused, and none of them changes a shipment;
 *  - a regenerated secret invalidates the previous one immediately.
 *
 * Requires the server running on PORT (default 5000). Creates a `__verify_`
 * order and shipment, and removes them in a `finally`. Run with:
 *   npx tsx scripts/verify-webhook-endpoints.ts
 */
import { CourierProvider, ShipmentStatus } from "../src/generated/prisma/client";
import { envVars } from "../src/app/config/env";
import { prisma } from "../src/app/lib/prisma";
import { IntegrationService } from "../src/app/module/integration/integration.service";
import { IntegrationId } from "../src/app/module/integration/integration.constant";

const BASE = `http://localhost:${envVars.PORT || 5000}/api/v1`;

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const reachable = await fetch(`${BASE}/settings/public`)
    .then((response) => response.ok)
    .catch(() => false);

if (!reachable) {
    console.error(
        `\nThe server is not answering on ${BASE}. Start it with \`npm run dev --workspace server\` and run this again.\n`,
    );
    process.exit(1);
}

const CONSIGNMENT = `__verify_cid_${Date.now()}`;

const priorCredentials = await prisma.integrationCredential.findMany({
    where: { provider: IntegrationId.STEADFAST },
});
const priorRow = await prisma.integration.findUnique({
    where: { provider: IntegrationId.STEADFAST },
});

let orderId: string | null = null;
let customerId: string | null = null;

/** Posts a Steadfast-shaped delivery_status notification. */
const post = (url: string, token: string | null, status: string) =>
    fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
            consignment_id: CONSIGNMENT,
            notification_type: "delivery_status",
            status,
            updated_at: new Date().toISOString(),
        }),
    });

/** The shipment's current courier status, for asserting a webhook took effect. */
const currentStatus = async () => {
    const shipment = await prisma.shipment.findFirst({
        where: { consignmentId: CONSIGNMENT },
        select: { courierStatus: true, status: true },
    });
    return shipment;
};

try {
    const { secret, callbackUrl } = await IntegrationService.generateWebhookSecret(
        undefined,
        IntegrationId.STEADFAST,
    );

    // A minimal order and its shipment — the webhook needs something to apply a
    // status to, and applying it is what proves the route reached the handler.
    const order = await prisma.order.create({
        data: {
            orderNumber: `__verify_${Date.now()}`,
            status: "SHIPPED",
            subtotal: 0,
            totalAmount: 0,
            customer: {
                create: {
                    firstName: "__verify_Customer",
                    // Unique on the model, so it is stamped to avoid colliding
                    // with a real shopper or a previous run of this script.
                    phone: `__verify_${Date.now()}`,
                },
            },
            shipments: {
                create: {
                    consignmentId: CONSIGNMENT,
                    courierProvider: CourierProvider.STEADFAST,
                    status: ShipmentStatus.IN_TRANSIT,
                },
            },
        },
        select: { id: true, customerId: true },
    });
    orderId = order.id;
    customerId = order.customerId;

    console.log("\n--- The generated callback URL is the one that works ---\n");

    check(
        "the callback URL points at the new webhooks path",
        callbackUrl.includes("/api/v1/webhooks/STEADFAST/"),
        `the merchant pastes this into the courier's panel — got ${callbackUrl}`,
    );

    const accepted = await post(callbackUrl, secret, "in_review");

    check(
        "the new path accepts the stored token",
        accepted.ok,
        `HTTP ${accepted.status} — this is the URL the admin tells the merchant to use`,
    );

    check(
        "the notification actually reached the handler",
        (await currentStatus())?.courierStatus === "in_review",
        "a 200 from a route that applied nothing would be worse than a refusal",
    );

    console.log("\n--- The legacy path authenticates identically ---\n");

    const legacy = await post(`${BASE}/courier/webhook/STEADFAST`, secret, "delivered");

    check(
        "the legacy per-provider path still accepts the same token",
        legacy.ok,
        `HTTP ${legacy.status} — a portal pointing at the old URL must keep working`,
    );

    check(
        "the legacy path applied the status too",
        (await currentStatus())?.courierStatus === "delivered",
        "same handler, same effect — two doors into one implementation",
    );

    const bareAlias = await post(`${BASE}/courier/webhook`, secret, "in_review");

    check(
        "the pre-provider alias still works",
        bareAlias.ok,
        `HTTP ${bareAlias.status} — the oldest registered URL of all`,
    );

    console.log("\n--- Every unauthenticated shape is refused ---\n");

    const before = (await currentStatus())?.courierStatus;

    const wrongToken = await post(callbackUrl, "not-the-token", "delivered");

    check(
        "a wrong token is refused",
        wrongToken.status === 401,
        `HTTP ${wrongToken.status} — the bearer token is the entire boundary`,
    );

    const noToken = await post(callbackUrl, null, "delivered");

    check(
        "a missing token is refused",
        noToken.status === 401,
        `HTTP ${noToken.status} — an absent header must not read as an empty match`,
    );

    const unknownId = await post(
        `${BASE}/webhooks/STEADFAST/${"0".repeat(32)}`,
        secret,
        "delivered",
    );

    check(
        "an unknown publicId is 404, not 401",
        unknownId.status === 404,
        `HTTP ${unknownId.status} — there is no integration to authenticate against, so 401 would imply a right token exists`,
    );

    const mismatched = callbackUrl.replace("/STEADFAST/", "/MANUAL/");
    const providerMismatch = await post(mismatched, secret, "delivered");

    check(
        "a provider that disagrees with the publicId is refused",
        providerMismatch.status === 404,
        `HTTP ${providerMismatch.status} — one integration's URL with another's name belongs to neither`,
    );

    check(
        "none of the refusals changed the shipment",
        (await currentStatus())?.courierStatus === before,
        "a refused webhook must not half-apply",
    );

    console.log("\n--- Regenerating invalidates the previous secret ---\n");

    const regenerated = await IntegrationService.generateWebhookSecret(
        undefined,
        IntegrationId.STEADFAST,
    );

    const stale = await post(callbackUrl, secret, "delivered");

    check(
        "the previous secret stops working immediately",
        stale.status === 401,
        `HTTP ${stale.status} — two valid tokens is a longer window in which a leaked one still works`,
    );

    const fresh = await post(regenerated.callbackUrl, regenerated.secret, "delivered");

    check(
        "the new secret works",
        fresh.ok,
        `HTTP ${fresh.status} — the merchant pastes this one into the courier's panel`,
    );

    check(
        "the callback URL is unchanged by regeneration",
        regenerated.callbackUrl === callbackUrl,
        "only the secret rotates; re-pasting the URL every time would be a second chance to get it wrong",
    );
} finally {
    if (orderId) {
        await prisma.shipment.deleteMany({ where: { orderId } });
        await prisma.order.delete({ where: { id: orderId } }).catch(() => undefined);
    }
    if (customerId) {
        await prisma.customer.delete({ where: { id: customerId } }).catch(() => undefined);
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
    if (priorRow) {
        await prisma.integration.update({
            where: { provider: IntegrationId.STEADFAST },
            data: { enabled: priorRow.enabled, publicId: priorRow.publicId },
        });
    }

    const leftovers = await prisma.order.count({
        where: { orderNumber: { startsWith: "__verify_" } },
    });
    console.log(`\nCleanup: ${leftovers} __verify_ order(s) remaining (expected 0).`);

    await prisma.$disconnect();
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
