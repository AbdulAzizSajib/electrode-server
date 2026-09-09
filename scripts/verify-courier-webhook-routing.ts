/**
 * Verifies that a webhook reaches the right consignment, and only the right one.
 *
 * Every property here guards a failure that would look like success in a log:
 *
 *  - **A consignment is matched on (provider, id), not id alone.** Two couriers
 *    issue ids from their own spaces, so both can legitimately issue "1234567".
 *    Matching on the id alone writes one courier's status onto another courier's
 *    parcel — the customer is told their delivered order is cancelled, and
 *    nothing anywhere records that the two were ever confused.
 *  - **An unknown consignment is acknowledged, not refused.** The courier is not
 *    at fault for a consignment we no longer hold, and a non-200 invites endless
 *    retries of something that can never succeed.
 *  - **A replay changes nothing.** Deliveries must be assumed to repeat, and an
 *    appended duplicate shows the operator a timeline that stutters.
 *  - **Status interpretation is the provider's.** The service must not be
 *    parsing another company's vocabulary.
 *
 * Exercises the service directly rather than over HTTP, like every other verify
 * script here. Token rejection is a middleware concern covered by reading
 * `courier.guard.ts`; what this script can prove is that even a correctly
 * authenticated call cannot cross provider boundaries.
 *
 * NOT read-only: creates a customer, orders and shipments prefixed
 * `__verify_wh`, and removes them in a `finally`.
 *
 * Run with: npx tsx scripts/verify-courier-webhook-routing.ts
 */
import { CourierProvider, OrderStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { CourierService } from "../src/app/module/courier/courier.service";
import { isSupportedProvider, resolveProvider } from "../src/app/module/courier/providers";
import { ManualProvider } from "../src/app/module/courier/providers/manual.provider";
import { SteadfastProvider } from "../src/app/module/courier/providers/steadfast.provider";

const MARKER = "__verify_wh";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const webhookBody = (consignmentId: string, status: string, updatedAt: string) => ({
    notification_type: "delivery_status",
    consignment_id: consignmentId,
    status,
    updated_at: updatedAt,
    tracking_message: "Delivered to the recipient",
});

async function main() {
    console.log("\n--- Provider resolution ---\n");

    check(
        "an unknown provider name is rejected",
        !isSupportedProvider("pathao"),
        "the webhook route refuses it before any consignment lookup, so an unauthenticated caller cannot make us query",
    );

    check(
        "a registered provider name is accepted",
        isSupportedProvider(CourierProvider.STEADFAST) &&
            isSupportedProvider(CourierProvider.MANUAL),
        "",
    );

    check(
        "MANUAL declares no webhook capability",
        !ManualProvider.capabilities.webhook,
        "so its endpoint 404s rather than accepting notifications for a courier we do not talk to",
    );

    check(
        "resolving an unregistered provider throws rather than returning undefined",
        (() => {
            try {
                resolveProvider("PATHAO" as CourierProvider);
                return false;
            } catch {
                return true;
            }
        })(),
        "a silent undefined would fail further along, with a stack trace pointing at the symptom",
    );

    console.log("\n--- A webhook reaches only its own provider's consignment ---\n");

    const customer = await prisma.customer.create({
        data: { firstName: MARKER, lastName: "Test", phone: `+8801799${Date.now() % 1000000}` },
    });

    const makeOrder = async (suffix: string) =>
        prisma.order.create({
            data: {
                orderNumber: `${MARKER}-${suffix}`,
                customerId: customer.id,
                status: OrderStatus.SHIPPED,
                subtotal: 100,
                totalAmount: 100,
            },
        });

    // The collision case: the SAME consignment id under two providers, which the
    // old global unique constraint could not even represent.
    const COLLIDING_ID = `${MARKER}-777`;

    const steadfastOrder = await makeOrder("sf");
    const steadfastShipment = await prisma.shipment.create({
        data: {
            orderId: steadfastOrder.id,
            courierProvider: CourierProvider.STEADFAST,
            consignmentId: COLLIDING_ID,
            courierStatus: "in_transit",
        },
    });

    const manualOrder = await makeOrder("mn");
    const manualShipment = await prisma.shipment.create({
        data: {
            orderId: manualOrder.id,
            courierProvider: CourierProvider.MANUAL,
            consignmentId: COLLIDING_ID,
            courierStatus: "in_transit",
        },
    });

    check(
        "the same consignment id can exist under two providers",
        steadfastShipment.id !== manualShipment.id,
        "each courier issues ids from its own space; a global unique would have rejected the second outright",
    );

    const delivered = await CourierService.handleWebhook(
        SteadfastProvider,
        webhookBody(COLLIDING_ID, "delivered", "2026-09-09 10:00:00"),
    );

    check(
        "the webhook matched a consignment",
        delivered.matched,
        "",
    );

    const sfAfter = await prisma.shipment.findUnique({
        where: { id: steadfastShipment.id },
        select: { courierStatus: true },
    });
    const mnAfter = await prisma.shipment.findUnique({
        where: { id: manualShipment.id },
        select: { courierStatus: true },
    });

    check(
        "the Steadfast consignment was updated",
        sfAfter?.courierStatus === "delivered",
        `status is ${sfAfter?.courierStatus}`,
    );

    check(
        "the other provider's consignment with the same id was NOT touched",
        mnAfter?.courierStatus === "in_transit",
        mnAfter?.courierStatus === "in_transit"
            ? "matching on the id alone would have marked someone else's parcel delivered"
            : `status is ${mnAfter?.courierStatus} — a cross-provider write`,
    );

    console.log("\n--- Replays and unknown consignments ---\n");

    const replay = await CourierService.handleWebhook(
        SteadfastProvider,
        webhookBody(COLLIDING_ID, "delivered", "2026-09-09 10:00:00"),
    );

    check(
        "a re-delivered notification is recognised as a duplicate",
        replay.matched && replay.duplicate === true,
        "the dedupeKey constraint catches it, so the timeline does not stutter",
    );

    const events = await prisma.courierTrackingEvent.count({
        where: { shipmentId: steadfastShipment.id },
    });

    check(
        "the replay appended no second history row",
        events === 1,
        `history holds ${events} row(s)`,
    );

    const unknown = await CourierService.handleWebhook(
        SteadfastProvider,
        webhookBody(`${MARKER}-nonexistent`, "delivered", "2026-09-09 11:00:00"),
    );

    check(
        "an unknown consignment is acknowledged, not failed",
        unknown.matched === false && unknown.reason === "unknown-consignment",
        "answering with an error would invite retries of something that can never succeed",
    );

    const crossProvider = await CourierService.handleWebhook(
        ManualProvider,
        webhookBody(COLLIDING_ID, "cancelled", "2026-09-09 12:00:00"),
    );

    check(
        "a provider with no webhook parser cannot apply a status",
        crossProvider.matched === false,
        "MANUAL declares no webhook capability, so it has no parseWebhook and reads nothing",
    );

    const mnUntouched = await prisma.shipment.findUnique({
        where: { id: manualShipment.id },
        select: { courierStatus: true },
    });

    check(
        "and its consignment is still untouched",
        mnUntouched?.courierStatus === "in_transit",
        `status is ${mnUntouched?.courierStatus}`,
    );

    console.log("\n--- An unreadable payload is refused, not half-applied ---\n");

    const noId = await CourierService.handleWebhook(SteadfastProvider, {
        notification_type: "delivery_status",
        status: "delivered",
    });

    check(
        "a payload with no consignment id is rejected",
        noId.matched === false && noId.reason === "unreadable",
        "a half-built reading would have nothing to match against",
    );
}

main()
    .catch((error) => {
        console.error(error);
        failures += 1;
    })
    .finally(async () => {
        const orders = await prisma.order.findMany({
            where: { orderNumber: { startsWith: MARKER } },
            select: { id: true },
        });
        const orderIds = orders.map((o) => o.id);

        const shipments = await prisma.shipment.findMany({
            where: { orderId: { in: orderIds } },
            select: { id: true },
        });

        await prisma.courierTrackingEvent.deleteMany({
            where: { shipmentId: { in: shipments.map((s) => s.id) } },
        });
        await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.customer.deleteMany({ where: { firstName: MARKER } });

        await prisma.$disconnect();

        console.log(
            `\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`,
        );
        process.exit(failures === 0 ? 0 : 1);
    });
