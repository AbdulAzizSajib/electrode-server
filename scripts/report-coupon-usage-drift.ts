/**
 * Compares each coupon's stored `usageCount` against the redemptions that
 * actually stand behind it.
 *
 * `usageCount` was incremented when an order was placed and decremented
 * nowhere, so a cancelled order consumed the shop's global allowance forever —
 * while `perCustomerLimit`, which has always been derived by counting
 * non-cancelled orders, released it. The two limits disagreed by construction,
 * and a merchant hitting the phantom ceiling could only work around it by
 * inflating `usageLimit`, corrupting the number they actually wanted to
 * enforce.
 *
 * Enforcement now counts orders for both limits, and the admin reports that
 * derived figure, so this drift no longer has any effect. The script remains
 * useful for two things: sizing what the column got wrong before the change,
 * and — if the column is ever promoted back to a source of truth — proving it
 * agrees with the orders again.
 *
 * A coupon whose stored count is HIGHER than its redemptions is the expected
 * shape (cancellations). LOWER is more interesting: it means orders carry the
 * code that the counter never saw, e.g. rows written directly to the database.
 *
 * Read-only. Writes nothing, and is safe to run against production.
 *
 * Run:  npx tsx scripts/report-coupon-usage-drift.ts
 */
import { OrderStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";

async function main() {
    const coupons = await prisma.coupon.findMany({
        select: { id: true, code: true, usageCount: true, usageLimit: true },
        orderBy: { code: "asc" },
    });

    if (coupons.length === 0) {
        console.log("No coupons to check.");
        return;
    }

    const grouped = await prisma.order.groupBy({
        by: ["couponCode"],
        where: {
            couponCode: { in: coupons.map((coupon) => coupon.code) },
            status: { notIn: [OrderStatus.CANCELLED] },
        },
        _count: { _all: true },
    });

    const standingByCode = new Map(
        grouped.map((row) => [row.couponCode as string, row._count._all]),
    );

    const drifted: {
        code: string;
        stored: number;
        standing: number;
        usageLimit: number | null;
    }[] = [];

    for (const coupon of coupons) {
        const standing = standingByCode.get(coupon.code) ?? 0;
        if (coupon.usageCount !== standing) {
            drifted.push({
                code: coupon.code,
                stored: coupon.usageCount,
                standing,
                usageLimit: coupon.usageLimit,
            });
        }
    }

    if (drifted.length === 0) {
        console.log(
            `All ${coupons.length} coupon(s) have a stored usage count matching their standing redemptions.`,
        );
        return;
    }

    console.log(
        `${drifted.length} of ${coupons.length} coupon(s) have a stored usage count that disagrees with their orders.\n`,
    );

    for (const row of drifted) {
        const limit = row.usageLimit === null ? "unlimited" : String(row.usageLimit);
        console.log(`  ${row.code}`);
        console.log(`    stored usageCount : ${row.stored}   (limit ${limit})`);
        console.log(`    standing orders   : ${row.standing}`);

        if (row.stored > row.standing) {
            const phantom = row.stored - row.standing;
            const wouldHaveBlocked =
                row.usageLimit !== null && row.stored >= row.usageLimit && row.standing < row.usageLimit;
            console.log(
                `    ${phantom} phantom redemption(s) from cancelled orders` +
                    (wouldHaveBlocked
                        ? " — this coupon would have read as exhausted while still valid"
                        : ""),
            );
        } else {
            console.log(
                `    ${row.standing - row.stored} order(s) carry this code that the counter never saw`,
            );
        }
        console.log("");
    }

    console.log(
        "No action needed: both usage limits are now counted from these orders, and the\n" +
            "admin shows the standing figure. The stored column is retained only so a\n" +
            "rollback still has a moving counter — see Coupon.usageCount in the schema.",
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
