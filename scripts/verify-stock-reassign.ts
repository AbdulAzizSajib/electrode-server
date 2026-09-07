/**
 * Verifies `StockService.reassignStockVariant` — the repair path for stock that
 * was received against the wrong variant, or against no variant at all.
 *
 * The bug it undoes is silent end to end: stock is held per (warehouse,
 * product, variant) and a customer order deducts against the variant bought, so
 * units on a `variantId: null` row of a variable product can never be sold. The
 * merchant receives 50, every figure looks right, and the storefront shows the
 * product out of stock. `adjustStock` cannot fix it — it changes a row's
 * quantity, never which variant the row is for.
 *
 * What is checked here is the part that would corrupt inventory if it were
 * wrong: that the move CONSERVES stock. A reassignment must leave the product's
 * total exactly as it found it while moving the variant mirrors, because the
 * same physical units simply changed which label they are filed under. An
 * implementation that routed this through `applyDenormalizedStockDelta` — which
 * credits the product on every call — would silently inflate the product total
 * on every correction, and nothing in the UI would show it.
 *
 * The guards are exercised too, since each one protects against a different way
 * of inventing or destroying stock: a variant of another product, a quantity
 * beyond what is unreserved, and a no-op onto the row's own variant.
 *
 * NOT read-only: creates a warehouse, a product and two variants, all prefixed
 * `VERIFY-STOCK-REASSIGN`, and removes them in a `finally` so a failure
 * part-way through still leaves the database as it found it.
 *
 * Run with: npx tsx scripts/verify-stock-reassign.ts
 */
import { ProductStatus, StockMovementType } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { StockService } from "../src/app/module/stock/stock.service";

const MARKER = "VERIFY-STOCK-REASSIGN";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Asserts a call rejects, and reports the message so a wrong-reason pass is visible. */
const expectRejection = async (label: string, run: () => Promise<unknown>) => {
    try {
        await run();
        check(label, false, "expected a rejection, but the call succeeded");
    } catch (error) {
        check(label, true, `rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
};

async function main() {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) throw new Error("No user to attribute the audit log entry to.");

    const warehouse = await prisma.warehouse.create({
        data: { name: `${MARKER} Warehouse`, code: `${MARKER}-WH` },
    });

    const product = await prisma.product.create({
        data: {
            name: `${MARKER} Speaker`,
            slug: `${MARKER.toLowerCase()}-speaker`,
            sku: `${MARKER}-SKU`,
            offerPrice: 1000,
            status: ProductStatus.ACTIVE,
            variants: {
                create: [
                    { name: "Black", sku: `${MARKER}-BLACK` },
                    { name: "Navy", sku: `${MARKER}-NAVY` },
                ],
            },
        },
        include: { variants: { orderBy: { sku: "asc" } } },
    });

    const [black, navy] = product.variants;

    // The exact shape the old purchase-order form produced: quantity held
    // against the product, attributed to no variant.
    const stranded = await prisma.stock.create({
        data: { warehouseId: warehouse.id, productId: product.id, variantId: null, quantity: 50 },
    });
    await prisma.product.update({
        where: { id: product.id },
        data: { stockQuantity: 50 },
    });

    // ---- guards, before the state-changing happy path ----

    const otherProduct = await prisma.product.create({
        data: {
            name: `${MARKER} Other`,
            slug: `${MARKER.toLowerCase()}-other`,
            sku: `${MARKER}-OTHER-SKU`,
            offerPrice: 500,
            status: ProductStatus.ACTIVE,
            variants: { create: [{ name: "Red", sku: `${MARKER}-RED` }] },
        },
        include: { variants: true },
    });

    await expectRejection("refuses a variant of a different product", () =>
        StockService.reassignStockVariant(user.id, stranded.id, {
            variantId: otherProduct.variants[0].id,
            quantity: 10,
        }),
    );

    await expectRejection("refuses more than the row holds", () =>
        StockService.reassignStockVariant(user.id, stranded.id, {
            variantId: black.id,
            quantity: 51,
        }),
    );

    // Reserved units back an order already placed against this row; moving them
    // would leave that order pointing at stock the row no longer has.
    await prisma.stock.update({ where: { id: stranded.id }, data: { reservedQuantity: 5 } });
    await expectRejection("refuses to move reserved units", () =>
        StockService.reassignStockVariant(user.id, stranded.id, {
            variantId: black.id,
            quantity: 46,
        }),
    );
    await prisma.stock.update({ where: { id: stranded.id }, data: { reservedQuantity: 0 } });

    // ---- the happy path, split across both variants ----

    await StockService.reassignStockVariant(user.id, stranded.id, {
        variantId: black.id,
        quantity: 30,
    });
    await StockService.reassignStockVariant(user.id, stranded.id, {
        variantId: navy.id,
        quantity: 20,
    });

    const [sourceAfter, blackStock, navyStock, productAfter, blackAfter, navyAfter] =
        await Promise.all([
            prisma.stock.findUnique({ where: { id: stranded.id } }),
            prisma.stock.findFirst({ where: { productId: product.id, variantId: black.id } }),
            prisma.stock.findFirst({ where: { productId: product.id, variantId: navy.id } }),
            prisma.product.findUnique({ where: { id: product.id }, select: { stockQuantity: true } }),
            prisma.productVariant.findUnique({ where: { id: black.id }, select: { stockQuantity: true } }),
            prisma.productVariant.findUnique({ where: { id: navy.id }, select: { stockQuantity: true } }),
        ]);

    check(
        "the stranded row is emptied",
        sourceAfter?.quantity === 0,
        `variantless row holds ${sourceAfter?.quantity}, expected 0`,
    );
    check(
        "the ledger moved to the variants",
        blackStock?.quantity === 30 && navyStock?.quantity === 20,
        `Black ${blackStock?.quantity} (expected 30), Navy ${navyStock?.quantity} (expected 20)`,
    );
    check(
        "the variant mirrors moved with it",
        blackAfter?.stockQuantity === 30 && navyAfter?.stockQuantity === 20,
        `Black ${blackAfter?.stockQuantity} (expected 30), Navy ${navyAfter?.stockQuantity} (expected 20)`,
    );

    // The one that matters most: nothing was created or destroyed. A product
    // total of 100 here would mean every correction silently doubled the stock.
    check(
        "the product total is unchanged — stock was moved, not created",
        productAfter?.stockQuantity === 50,
        `product total ${productAfter?.stockQuantity}, expected 50`,
    );

    const movements = await prisma.stockMovement.findMany({
        where: { productId: product.id },
        select: { type: true, quantity: true, variantId: true },
    });
    const out = movements.filter((m) => m.type === StockMovementType.TRANSFER_OUT);
    const into = movements.filter((m) => m.type === StockMovementType.TRANSFER_IN);

    check(
        "each move is recorded as a transfer pair, not as a loss and a gain",
        out.length === 2 && into.length === 2,
        `${out.length} TRANSFER_OUT and ${into.length} TRANSFER_IN (expected 2 and 2), ` +
            `${movements.length} movement(s) total`,
    );

    await expectRejection("refuses a move onto the variant the stock already has", () =>
        StockService.reassignStockVariant(user.id, blackStock!.id, {
            variantId: black.id,
            quantity: 1,
        }),
    );

    console.log(
        `\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`,
    );
    if (failures > 0) process.exitCode = 1;
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        /*
         * Movements are matched by product, not by note: the notes this path
         * writes are generated from the variant name, so they carry no marker.
         * They also do not cascade from Product (`onDelete: Cascade` is on the
         * relation, but the rows are removed explicitly here so the deletion
         * order is not left to inference).
         */
        const seeded = await prisma.product.findMany({
            where: { sku: { contains: MARKER } },
            select: { id: true },
        });
        const seededIds = seeded.map((p) => p.id);

        await prisma.stockMovement.deleteMany({ where: { productId: { in: seededIds } } });
        await prisma.stock.deleteMany({ where: { productId: { in: seededIds } } });
        await prisma.product.deleteMany({ where: { id: { in: seededIds } } });
        await prisma.warehouse.deleteMany({ where: { code: { contains: MARKER } } });
        await prisma.$disconnect();
    });
