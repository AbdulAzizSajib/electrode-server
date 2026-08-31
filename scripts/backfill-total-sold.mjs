/**
 * Loads `Product.totalSold` from order history.
 *
 * The migration that added the column defaults every product to 0, so without
 * this the "best selling" listing ranks by post-deploy sales only — arbitrary
 * for weeks on a store with history.
 *
 * Idempotent by construction: it computes each product's total from scratch and
 * SETs it, never incrementing. Running it twice is the same as running it once,
 * which is what also makes it the repair procedure when the counter is
 * suspected to have drifted from the underlying orders (design.md Decision 6) —
 * for instance after a direct database write to Payment.status, which the
 * live path in payment.service.ts cannot observe.
 *
 *   pnpm backfill:total-sold             apply
 *   pnpm backfill:total-sold --dry-run   report only, change nothing
 *
 * Run under tsx, not plain node: this project's Prisma client generates
 * TypeScript (src/generated/prisma/*.ts) with no compiled .js alongside it, so
 * `node scripts/backfill-total-sold.mjs` cannot resolve the import.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

/**
 * The payment states that count as a sale.
 *
 * MUST match PAID_PAYMENT_STATUSES in src/app/module/payment/payment.service.ts.
 * If the two disagree this script silently corrupts the counter it exists to
 * repair — it would "fix" every product to a figure the live path then diverges
 * from on the next payment.
 */
const PAID_PAYMENT_STATUSES = ["PAID"];

const dryRun = process.argv.includes("--dry-run");

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const main = async () => {
    console.log(dryRun ? "DRY RUN — no writes will be made\n" : "Backfilling Product.totalSold\n");

    // Sum quantity per product over orders that have a qualifying payment.
    // Scoped through the order's payments rather than the order's own status:
    // Order has no paymentStatus column, so "was paid for" is only observable
    // on the Payment row (design.md Context).
    const sold = await prisma.orderItem.groupBy({
        by: ["productId"],
        where: { order: { payments: { some: { status: { in: PAID_PAYMENT_STATUSES } } } } },
        _sum: { quantity: true },
    });

    const soldByProductId = new Map(sold.map((row) => [row.productId, row._sum.quantity ?? 0]));

    // Every product, not just those with sales: a product whose only paid order
    // was later refunded must be driven back down to 0, and it has no row in
    // the aggregate above to do that.
    const products = await prisma.product.findMany({
        select: { id: true, name: true, totalSold: true },
    });

    const changes = products
        .map((product) => ({
            ...product,
            computed: soldByProductId.get(product.id) ?? 0,
        }))
        .filter((product) => product.computed !== product.totalSold);

    if (changes.length === 0) {
        console.log(`No changes. All ${products.length} products already match their order history.`);
    } else {
        console.log(`${changes.length} of ${products.length} products need updating:\n`);
        for (const change of changes) {
            console.log(`  ${change.totalSold} -> ${change.computed}   ${change.name}`);
        }

        if (!dryRun) {
            // Absolute SET, never increment — this is what makes a second run a
            // no-op instead of a doubling.
            await prisma.$transaction(
                changes.map((change) =>
                    prisma.product.update({
                        where: { id: change.id },
                        data: { totalSold: change.computed },
                    }),
                ),
            );
            console.log(`\nUpdated ${changes.length} products.`);
        } else {
            console.log("\nDry run — nothing written.");
        }
    }

    const top = await prisma.product.findMany({
        where: { totalSold: { gt: 0 } },
        select: { name: true, totalSold: true },
        orderBy: { totalSold: "desc" },
        take: 10,
    });

    console.log("\nTop sellers now:");
    if (top.length === 0) {
        console.log("  (none — no product has a paid sale yet)");
    } else {
        for (const product of top) {
            console.log(`  ${String(product.totalSold).padStart(6)}  ${product.name}`);
        }
    }
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
