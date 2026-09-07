/**
 * Finds stock stranded on a variable product's `variantId: null` row.
 *
 * Stock is held per (warehouse, product, variant), and a customer order deducts
 * against the variant actually bought. A purchase order line that named no
 * variant therefore received its units onto a row nothing can ever match: the
 * merchant receives 50, `Product.stockQuantity` goes up, every variant stays at
 * 0, and the storefront — which reads `variant.stockQuantity > 0` — goes on
 * calling the product out of stock. Nothing errors at any point.
 *
 * The admin purchase-order form no longer allows this (a line for a product
 * with variants must name one), but rows created before that fix are still
 * sitting in the ledger. This script only REPORTS them, so the damage can be
 * seen before anything is decided about it.
 *
 * A `variantId: null` row on a SIMPLE product is correct and is not reported —
 * that product has no variants to attribute stock to.
 *
 * Read-only. Writes nothing, and is safe to run against production.
 *
 * Run:  npx tsx scripts/report-variantless-stock.ts
 */
import { prisma } from "../src/app/lib/prisma";

async function main() {
    const stranded = await prisma.stock.findMany({
        where: {
            variantId: null,
            // Only a product that HAS variants can have stock stranded this
            // way. `some: {}` is "has at least one variant".
            product: { variants: { some: {} } },
            // An emptied row is a repair that has already been done — the row
            // itself survives reassignment, holding zero. Listing it would keep
            // reporting a problem that no longer exists.
            quantity: { gt: 0 },
        },
        include: {
            warehouse: { select: { name: true } },
            product: {
                select: {
                    id: true,
                    name: true,
                    stockQuantity: true,
                    variants: { select: { id: true, name: true, sku: true, stockQuantity: true } },
                },
            },
        },
        orderBy: { quantity: "desc" },
    });

    if (stranded.length === 0) {
        console.log("No stranded stock: every variable product's stock is attributed to a variant.");
        return;
    }

    console.log(
        `${stranded.length} stock row(s) hold quantity against a variable product but no variant.\n` +
            "The storefront cannot sell any of it.\n",
    );

    let totalStranded = 0;

    for (const row of stranded) {
        totalStranded += row.quantity;

        console.log(`"${row.product.name}" @ ${row.warehouse.name}`);
        console.log(`  stranded quantity : ${row.quantity}  (stock row ${row.id})`);
        console.log(`  reserved          : ${row.reservedQuantity}`);
        console.log(`  product total     : ${row.product.stockQuantity}`);
        console.log("  variants:");
        for (const variant of row.product.variants) {
            console.log(
                `    - ${variant.name} (${variant.sku}) holds ${variant.stockQuantity}` +
                    (variant.stockQuantity === 0 ? "   <- reads OUT OF STOCK" : ""),
            );
        }
        console.log("");
    }

    console.log(`${totalStranded} unit(s) stranded in total across ${stranded.length} row(s).`);
    console.log(
        "\nRepair these from the admin: Inventory > Stock flags each row above as\n" +
            '"No variant" and offers "Fix variant", which moves the quantity onto the\n' +
            "variant it belongs to without changing how much stock you have.",
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
