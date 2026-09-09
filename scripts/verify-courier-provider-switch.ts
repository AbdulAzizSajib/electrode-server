/**
 * Verifies the guard that refuses a courier switch while parcels are in flight.
 *
 * The failure this prevents is quiet. Every consignment is polled against the
 * provider that created it, so a mid-flight switch does not corrupt anything —
 * it simply happens at the wrong moment, with the old courier's account funded
 * and the new one's credentials possibly unset. What makes it worth a guard is
 * that an operator watching statuses stop moving has no way to connect that to a
 * setting somebody changed last week.
 *
 * Four properties, each of which would pass a casual read if broken:
 *
 *  - a non-terminal consignment blocks the switch, and the refusal NAMES THE
 *    COUNT — a generic "not allowed" leaves the merchant with no idea when to
 *    retry;
 *  - `unknown` counts as in flight. It is the courier telling us to contact
 *    support, which is the opposite of settled, and a terminal-set that included
 *    it would let exactly the parcels most needing attention be abandoned;
 *  - settled consignments do not block, so a merchant who has waited can switch;
 *  - a shop that has never dispatched can switch freely.
 *
 * NOT read-only: creates a customer, order and shipment prefixed
 * `__verify_courier_switch`, and removes them in a `finally` so a failure
 * part-way through still leaves the database as it found it. The settings row is
 * restored to whatever it held before.
 *
 * Run with: npx tsx scripts/verify-courier-provider-switch.ts
 */
import { CourierProvider, OrderStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { CourierService } from "../src/app/module/courier/courier.service";
import { StoreSettingService } from "../src/app/module/store-setting/store-setting.service";

const MARKER = "__verify_courier_switch";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Runs a switch and returns the rejection message, or null when it succeeded. */
const attemptSwitch = async (
    userId: string,
    provider: CourierProvider,
): Promise<string | null> => {
    try {
        await StoreSettingService.updateStoreSetting(userId, { courierProvider: provider });
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
};

async function main() {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) throw new Error("No user to attribute the settings change to.");

    const before = await prisma.storeSetting.findUnique({
        where: { id: "singleton" },
        select: { courierProvider: true },
    });

    // Start from a known provider so the switch under test is a real change.
    await prisma.storeSetting.upsert({
        where: { id: "singleton" },
        update: { courierProvider: CourierProvider.STEADFAST },
        create: { id: "singleton", courierProvider: CourierProvider.STEADFAST },
    });

    console.log("\n--- A shop with no consignments switches freely ---\n");

    const cleanSwitch = await attemptSwitch(user.id, CourierProvider.MANUAL);
    check(
        "a shop that has never dispatched can switch",
        cleanSwitch === null,
        cleanSwitch ?? "accepted, as it must be — there is nothing to strand",
    );

    // Back to STEADFAST so the in-flight tests switch away from it.
    await attemptSwitch(user.id, CourierProvider.STEADFAST);

    console.log("\n--- An in-flight consignment blocks the switch ---\n");

    const customer = await prisma.customer.create({
        data: { firstName: MARKER, lastName: "Test", phone: `+8801700${Date.now() % 1000000}` },
    });

    const order = await prisma.order.create({
        data: {
            orderNumber: `${MARKER}-1`,
            customerId: customer.id,
            status: OrderStatus.SHIPPED,
            subtotal: 100,
            totalAmount: 100,
        },
    });

    const shipment = await prisma.shipment.create({
        data: {
            orderId: order.id,
            courierProvider: CourierProvider.STEADFAST,
            consignmentId: `${MARKER}-c1`,
            courierStatus: "in_transit",
        },
    });

    const blocked = await attemptSwitch(user.id, CourierProvider.MANUAL);

    check(
        "an in-transit consignment blocks the switch",
        blocked !== null,
        blocked ?? "the switch was accepted, stranding the parcel",
    );

    check(
        "the refusal names the count",
        blocked !== null && /\b1\b/.test(blocked),
        blocked
            ? `message was: "${blocked}"`
            : "no refusal to inspect — 'not allowed' leaves the merchant with no idea when to retry",
    );

    const stillSteadfast = await prisma.storeSetting.findUnique({
        where: { id: "singleton" },
        select: { courierProvider: true },
    });

    check(
        "a refused switch leaves the configured provider unchanged",
        stillSteadfast?.courierProvider === CourierProvider.STEADFAST,
        `configured provider is ${stillSteadfast?.courierProvider}`,
    );

    console.log("\n--- `unknown` counts as in flight ---\n");

    await prisma.shipment.update({
        where: { id: shipment.id },
        data: { courierStatus: "unknown" },
    });

    const unknownBlocked = await attemptSwitch(user.id, CourierProvider.MANUAL);

    check(
        "a consignment in `unknown` still blocks the switch",
        unknownBlocked !== null,
        unknownBlocked ??
            "accepted — but `unknown` means the courier is telling us to contact support, which is the opposite of settled",
    );

    console.log("\n--- Settled consignments do not block ---\n");

    for (const settled of ["delivered", "cancelled", "partial_delivered"]) {
        await prisma.shipment.update({
            where: { id: shipment.id },
            data: { courierStatus: settled },
        });

        const count = await CourierService.countInFlightConsignments(CourierProvider.STEADFAST);

        check(
            `a ${settled} consignment is not counted as in flight`,
            count === 0,
            count === 0 ? "" : `counted ${count}`,
        );
    }

    await prisma.shipment.update({
        where: { id: shipment.id },
        data: { courierStatus: "delivered" },
    });

    const settledSwitch = await attemptSwitch(user.id, CourierProvider.MANUAL);

    check(
        "a shop whose consignments have all settled can switch",
        settledSwitch === null,
        settledSwitch ?? "accepted, as it must be once nothing is in transit",
    );

    console.log("\n--- A hand-entered shipment is not a consignment ---\n");

    await prisma.shipment.update({
        where: { id: shipment.id },
        data: { consignmentId: null, courierStatus: null },
    });

    const manualOnly = await CourierService.countInFlightConsignments(CourierProvider.STEADFAST);

    check(
        "a shipment with no consignment id is never in flight",
        manualOnly === 0,
        manualOnly === 0
            ? "it was never given to a courier, so no courier can be waiting on it"
            : `counted ${manualOnly}`,
    );

    // Restore whatever the shop had configured before this script ran.
    await prisma.storeSetting.update({
        where: { id: "singleton" },
        data: { courierProvider: before?.courierProvider ?? CourierProvider.STEADFAST },
    });
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

        await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.customer.deleteMany({ where: { firstName: MARKER } });

        await prisma.$disconnect();

        console.log(
            `\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`,
        );
        process.exit(failures === 0 ? 0 : 1);
    });
