/**
 * One-time backfill for remove-catalog-authored-stock.
 *
 * `Product.stockQuantity` and `ProductVariant.stockQuantity` are denormalized
 * mirrors of the `Stock` ledger — they exist so the storefront can read a total
 * without summing warehouse rows, and so the catalog can be sorted by stock.
 * Two things had let them drift from the ledger they mirror:
 *
 *  1. Product create/update accepted a `stockQuantity` and wrote it straight to
 *     the column, with no `Stock` row and no `StockMovement` behind it. The
 *     catalog then advertised stock that checkout — which reads the ledger —
 *     rejected. That field is now gone from the API.
 *
 *  2. `applyDenormalizedStockDelta` updated EITHER the variant total OR the
 *     product total, never both, so a variable product's own total was never
 *     maintained. It now credits both, as does checkout's deduction.
 *
 * This script makes the mirrors say what the ledger says: every product and
 * variant total is RESET to the summed `Stock.quantity` actually held for it.
 * A product whose mirror was inflated by a merchant-typed number drops to what
 * really exists; a variable product whose total was never maintained gains the
 * sum across its variants.
 *
 * It writes no `StockMovement` rows, because nothing moves — no stock is
 * created or destroyed here. The ledger is already correct and untouched; only
 * the cached copies of it change.
 *
 * Safe to run multiple times: it assigns an absolute value rather than a delta,
 * so a second run over unchanged data is a no-op.
 *
 * Run:  npx tsx scripts/backfill-stock-mirror.ts
 *       npx tsx scripts/backfill-stock-mirror.ts --dry-run
 */
import { prisma } from "../src/app/lib/prisma";

const dryRun = process.argv.includes("--dry-run");

async function main() {
    // The ledger, summed two ways in two queries rather than per product: by
    // variant (for variant totals) and by product (for product totals, which
    // include every variant's rows).
    const [byVariant, byProduct] = await Promise.all([
        prisma.stock.groupBy({ by: ["variantId"], _sum: { quantity: true } }),
        prisma.stock.groupBy({ by: ["productId"], _sum: { quantity: true } }),
    ]);

    const variantLedger = new Map<string, number>();
    for (const row of byVariant) {
        if (row.variantId) variantLedger.set(row.variantId, row._sum.quantity ?? 0);
    }

    const productLedger = new Map<string, number>();
    for (const row of byProduct) {
        productLedger.set(row.productId, row._sum.quantity ?? 0);
    }

    const products = await prisma.product.findMany({
        select: {
            id: true,
            name: true,
            stockQuantity: true,
            variants: { select: { id: true, name: true, stockQuantity: true } },
        },
    });

    let productsFixed = 0;
    let variantsFixed = 0;

    for (const product of products) {
        // Absent from the map means no Stock row exists for it at all, which is
        // zero held — the same thing the checkout's own lookup concludes.
        const trueTotal = productLedger.get(product.id) ?? 0;

        if (product.stockQuantity !== trueTotal) {
            console.log(
                `product "${product.name}": ${product.stockQuantity} -> ${trueTotal}` +
                    (product.stockQuantity > trueTotal ? "  (was advertising stock it did not hold)" : ""),
            );
            if (!dryRun) {
                await prisma.product.update({
                    where: { id: product.id },
                    data: { stockQuantity: trueTotal },
                });
            }
            productsFixed++;
        }

        for (const variant of product.variants) {
            const trueVariantTotal = variantLedger.get(variant.id) ?? 0;

            if (variant.stockQuantity !== trueVariantTotal) {
                console.log(
                    `  variant "${variant.name}": ${variant.stockQuantity} -> ${trueVariantTotal}`,
                );
                if (!dryRun) {
                    await prisma.productVariant.update({
                        where: { id: variant.id },
                        data: { stockQuantity: trueVariantTotal },
                    });
                }
                variantsFixed++;
            }
        }
    }

    console.log(
        `\n${dryRun ? "[dry run] would correct" : "corrected"} ` +
            `${productsFixed} product total(s) and ${variantsFixed} variant total(s) ` +
            `across ${products.length} product(s).`,
    );

    if (productsFixed > 0 || variantsFixed > 0) {
        console.log(
            "Products now reading 0 hold no stock in the ledger — receive a " +
                "purchase order to stock them.",
        );
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
