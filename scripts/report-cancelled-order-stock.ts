/**
 * Finds cancelled orders whose stock was never returned to the shelf.
 *
 * Placing an order deducts real stock. Cancelling one used to write only the
 * status and a history row — so the goods sat in the warehouse while the system
 * believed they were sold. Every cancellation permanently shrank sellable
 * inventory, silently, and the only lever an admin had was a manual stock
 * adjustment that then misreported a cancelled sale as a physical recount.
 *
 * Cancelling now restocks, but orders cancelled before that are still short.
 * This reports them; it does not correct them, because the physical count is
 * the merchant's to confirm — some of these goods may genuinely have gone
 * missing, and this script cannot tell that from a bookkeeping gap.
 *
 * Nets `SALE` movements against `CANCELLATION` ones per order, matching the
 * restock's own arithmetic, so an order already put right does not appear.
 *
 * Read-only. Writes nothing, and is safe to run against production.
 *
 * Run:  npx tsx scripts/report-cancelled-order-stock.ts
 */
import { OrderStatus, StockMovementType } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";

async function main() {
    const cancelled = await prisma.order.findMany({
        where: { status: OrderStatus.CANCELLED },
        select: { id: true, orderNumber: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    });

    if (cancelled.length === 0) {
        console.log("No cancelled orders to check.");
        return;
    }

    const movements = await prisma.stockMovement.groupBy({
        by: ["referenceId", "type"],
        where: {
            referenceId: { in: cancelled.map((order) => order.id) },
            type: { in: [StockMovementType.SALE, StockMovementType.CANCELLATION] },
        },
        _sum: { quantity: true },
    });

    /** orderId -> { sold, restored } in absolute units. */
    const byOrder = new Map<string, { sold: number; restored: number }>();
    for (const row of movements) {
        const orderId = row.referenceId as string;
        const entry = byOrder.get(orderId) ?? { sold: 0, restored: 0 };
        const units = Math.abs(row._sum.quantity ?? 0);

        if (row.type === StockMovementType.SALE) entry.sold += units;
        else entry.restored += units;

        byOrder.set(orderId, entry);
    }

    const outstanding: { orderNumber: string; createdAt: Date; missing: number }[] = [];

    for (const order of cancelled) {
        const entry = byOrder.get(order.id);
        // No SALE movements at all means the order never deducted stock —
        // cancelled before checkout completed, or predating the stock ledger.
        // Nothing to return, so not a discrepancy.
        if (!entry || entry.sold === 0) continue;

        const missing = entry.sold - entry.restored;
        if (missing > 0) {
            outstanding.push({ orderNumber: order.orderNumber, createdAt: order.createdAt, missing });
        }
    }

    if (outstanding.length === 0) {
        console.log(
            `All ${cancelled.length} cancelled order(s) had their stock returned. Nothing to correct.`,
        );
        return;
    }

    const totalMissing = outstanding.reduce((sum, row) => sum + row.missing, 0);

    console.log(
        `${outstanding.length} cancelled order(s) still hold stock deducted that was never returned.\n` +
            "These goods are on the shelf but the system does not believe they exist.\n",
    );

    for (const row of outstanding) {
        console.log(
            `  ${row.orderNumber} (cancelled order from ${row.createdAt.toISOString().slice(0, 10)}) — ${row.missing} unit(s) still deducted`,
        );
    }

    console.log(`\n${totalMissing} unit(s) unaccounted for in total.`);
    console.log(
        "\nCorrect these from the admin: Inventory > Stock, using Adjust on each affected\n" +
            "product to raise the count to what is physically on the shelf. Count first —\n" +
            "some of this stock may genuinely be missing rather than merely unrecorded.",
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
