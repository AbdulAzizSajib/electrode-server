/**
 * Finds returns whose restock does not match their status.
 *
 * Completing a return is supposed to put the goods back on the shelf exactly
 * once. Two bugs let that drift, both silent:
 *
 *  1. **Restocked twice.** The only guard was `existing.status !== COMPLETED`,
 *     and the admin's "Set status" control offered every status with no
 *     forward-only constraint — so COMPLETED -> APPROVED -> COMPLETED ran the
 *     restock a second time, inventing inventory the storefront then sold.
 *
 *  2. **Never restocked.** Issuing a refund force-completed the return without
 *     a warehouse, so it reached the same terminal status having moved no
 *     stock. The goods came back and the system never learned of them.
 *
 * Both are now prevented (terminal statuses, and the refund path stating
 * whether the goods returned), but rows written before that are still wrong.
 * This reports them; it does not touch them, because only the merchant knows
 * which physical goods actually came back.
 *
 * Counts `RETURN` movements per return via `referenceId`, which is what both
 * restock paths stamp with the return's id.
 *
 * Read-only. Writes nothing, and is safe to run against production.
 *
 * Run:  npx tsx scripts/report-return-restock-drift.ts
 */
import { ReturnStatus, StockMovementType } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";

async function main() {
    const completed = await prisma.returnRequest.findMany({
        where: { status: ReturnStatus.COMPLETED },
        select: {
            id: true,
            returnNumber: true,
            createdAt: true,
            order: { select: { orderNumber: true } },
            items: {
                select: {
                    quantity: true,
                    orderItem: { select: { productId: true, variantId: true } },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });

    if (completed.length === 0) {
        console.log("No completed returns to check.");
        return;
    }

    // One grouped query rather than one per return: `referenceId` carries the
    // return id on every RETURN movement either restock path writes.
    const movements = await prisma.stockMovement.groupBy({
        by: ["referenceId"],
        where: {
            type: StockMovementType.RETURN,
            referenceId: { in: completed.map((r) => r.id) },
        },
        _count: { _all: true },
        _sum: { quantity: true },
    });

    const byReturn = new Map(
        movements.map((m) => [
            m.referenceId as string,
            { rows: m._count._all, quantity: m._sum.quantity ?? 0 },
        ]),
    );

    const neverRestocked: typeof completed = [];
    const overRestocked: { ret: (typeof completed)[number]; actual: number; expected: number }[] = [];

    for (const ret of completed) {
        // What one correct restock would have added.
        const expectedUnits = ret.items.reduce((sum, item) => sum + item.quantity, 0);
        const expectedRows = ret.items.length;
        const actual = byReturn.get(ret.id);

        if (!actual || actual.rows === 0) {
            neverRestocked.push(ret);
            continue;
        }

        // Compare movement ROWS, not summed quantity: a return restocked twice
        // writes each item's movement twice. Summed units would also catch it,
        // but rows say plainly how many times the restock ran.
        if (expectedRows > 0 && actual.rows > expectedRows) {
            overRestocked.push({ ret, actual: actual.quantity, expected: expectedUnits });
        }
    }

    if (neverRestocked.length === 0 && overRestocked.length === 0) {
        console.log(
            `All ${completed.length} completed return(s) restocked exactly once. Nothing to correct.`,
        );
        return;
    }

    if (overRestocked.length > 0) {
        console.log(
            `${overRestocked.length} return(s) were restocked MORE THAN ONCE — the ledger holds stock that never physically arrived.\n`,
        );
        for (const { ret, actual, expected } of overRestocked) {
            console.log(`  ${ret.returnNumber} (order ${ret.order.orderNumber})`);
            console.log(`    added ${actual} unit(s); one correct restock would have added ${expected}`);
            console.log(`    excess: ${actual - expected} unit(s)`);
        }
        console.log("");
    }

    if (neverRestocked.length > 0) {
        console.log(
            `${neverRestocked.length} return(s) completed WITHOUT restocking — goods may have come back and never been recorded.\n`,
        );
        for (const ret of neverRestocked) {
            const units = ret.items.reduce((sum, item) => sum + item.quantity, 0);
            console.log(`  ${ret.returnNumber} (order ${ret.order.orderNumber}) — ${units} unit(s) unaccounted for`);
        }
        console.log(
            "\n  Some of these are legitimate: a refund for goods the customer keeps completes\n" +
                "  the return without a restock. Check each against what physically arrived.",
        );
        console.log("");
    }

    console.log(
        "Correct these from the admin: Inventory > Stock, using Adjust on the affected\n" +
            "product to bring the count back to what is physically on the shelf. The\n" +
            "adjustment records a note, so the correction is explainable later.",
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
