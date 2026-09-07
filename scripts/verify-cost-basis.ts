/**
 * Tasks 5.1 and 5.2 — inventory cost basis verification.
 *
 * Walks the happy paths of `add-weighted-average-cost-basis`: the landed-cost
 * allocation, the moving weighted average a goods receipt applies to
 * `Product.purchasePrice` / `ProductVariant.purchasePrice`, and the
 * `OrderItem.unitCost` snapshot that fixes an order's margin at placement.
 *
 * Two halves, deliberately. The arithmetic is a pure module
 * (purchase-order.cost.ts) and is checked with plain function calls — no
 * fixture, no database, no cleanup. Only the behaviour that genuinely needs a
 * database (does a receipt actually WRITE the new basis? does a later receipt
 * leave a placed order alone?) pays for one.
 *
 * Negative paths are out of scope here by design: this change's guards are
 * assertions about what must NOT block a receipt, and the one worth proving —
 * that a receipt pricing an item above its selling price still succeeds — is
 * checked as a happy path below.
 *
 * NOT read-only: creates a supplier, products, purchase orders and one guest
 * order, all prefixed `VERIFY-COST-BASIS`, and removes them in a `finally` so a
 * failure part-way through still leaves the database as it found it.
 *
 * Run with: npx tsx scripts/verify-cost-basis.ts
 */
import { ProductStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import {
    allocateLandedUnitCosts,
    weightedAverageCost,
} from "../src/app/module/purchase-order/purchase-order.cost";
import { PurchaseOrderService } from "../src/app/module/purchase-order/purchase-order.service";
import { OrderService } from "../src/app/module/order/order.service";

const MARKER = "VERIFY-COST-BASIS";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const num = (value: unknown) => (value == null ? null : Number(value));

// ------------------------------------------------------ pure arithmetic ---

const verifyArithmetic = () => {
    console.log("\n--- landed cost allocation (pure) ---");

    // The `api/inventory` spec's worked example: line values 1000 and 3000, so
    // the 800 of shipping + tax splits one quarter / three quarters.
    const spread = allocateLandedUnitCosts({
        items: [
            { id: "cheap", quantity: 10, unitCost: 100 },
            { id: "dear", quantity: 10, unitCost: 300 },
        ],
        shippingCost: 400,
        taxAmount: 400,
    });
    check(
        "shipping and tax spread by line value",
        spread.get("cheap") === 120 && spread.get("dear") === 360,
        `cheap = ${spread.get("cheap")} (expected 120), dear = ${spread.get("dear")} (expected 360)`,
    );

    const bare = allocateLandedUnitCosts({
        items: [{ id: "only", quantity: 4, unitCost: 250 }],
        shippingCost: 0,
        taxAmount: 0,
    });
    check(
        "no shipping or tax leaves unit cost untouched",
        bare.get("only") === 250,
        `landed = ${bare.get("only")} (expected 250)`,
    );

    const free = allocateLandedUnitCosts({
        items: [{ id: "free", quantity: 5, unitCost: 0 }],
        shippingCost: 100,
        taxAmount: 0,
    });
    check(
        "zero total line value does not divide by zero",
        free.get("free") === 0,
        `landed = ${free.get("free")} (expected 0 — no value to apportion against)`,
    );

    const empty = allocateLandedUnitCosts({
        items: [{ id: "nothing", quantity: 0, unitCost: 100 }],
        shippingCost: 50,
        taxAmount: 0,
    });
    check(
        "a zero-quantity line is absent rather than infinite",
        !empty.has("nothing"),
        `map has "nothing" = ${empty.has("nothing")} (expected false)`,
    );

    console.log("\n--- weighted average (pure) ---");

    check(
        "10 on hand at 90 plus 10 received at 110 averages to 100",
        weightedAverageCost(10, 90, 10, 110) === 100,
        `result = ${weightedAverageCost(10, 90, 10, 110)} (expected 100)`,
    );
    check(
        "a null existing cost takes the landed cost alone",
        weightedAverageCost(0, null, 5, 250) === 250,
        `result = ${weightedAverageCost(0, null, 5, 250)} (expected 250 — not averaged against zero)`,
    );
    check(
        "no stock on hand takes the landed cost alone",
        weightedAverageCost(0, 100, 5, 250) === 250,
        `result = ${weightedAverageCost(0, 100, 5, 250)} (expected 250)`,
    );
};

// ------------------------------------------------------------- fixtures ---

const createProduct = async (
    label: string,
    offerPrice: number,
    purchasePrice: number | null,
    stockQuantity: number,
    taxRuleId: string | null,
) =>
    prisma.product.create({
        data: {
            name: `${MARKER} ${label}`,
            slug: `${MARKER.toLowerCase()}-${label}-${Math.random().toString(36).slice(2, 8)}`,
            status: ProductStatus.ACTIVE,
            offerPrice,
            purchasePrice,
            stockQuantity,
            taxRuleId,
        },
    });

const main = async () => {
    verifyArithmetic();

    const actingUser = await prisma.user.findFirst({ select: { id: true } });
    if (!actingUser) throw new Error("No user in the database to attribute audit entries to");
    const actingUserId = actingUser.id;

    const warehouse = await prisma.warehouse.findFirst({ select: { id: true } });
    if (!warehouse) throw new Error("No warehouse in the database to receive stock into");

    const taxRule = await prisma.taxRule.findFirst({ select: { id: true } });

    const setting = await prisma.storeSetting.findFirst();
    const deliveryOptionKey = (
        (setting?.checkoutConfig as { delivery?: { options?: { key: string }[] } } | null)?.delivery
            ?.options ?? []
    )[0]?.key;
    if (!deliveryOptionKey) throw new Error("No delivery option configured to place a test order");

    const supplier = await prisma.supplier.create({
        data: { name: `${MARKER} supplier`, country: "Bangladesh" },
    });

    const productIds: string[] = [];
    const purchaseOrderIds: string[] = [];
    const orderIds: string[] = [];

    /** Creates a purchase order, receives the given quantity of its single line, returns nothing. */
    const orderAndReceive = async (
        productId: string,
        variantId: string | undefined,
        quantity: number,
        unitCost: number,
        receiveQuantity: number,
        extras?: { shippingCost?: number; taxAmount?: number },
    ) => {
        const po = await PurchaseOrderService.createPurchaseOrder(actingUserId, {
            supplierId: supplier.id,
            items: [{ productId, variantId, quantity, unitCost }],
            shippingCost: extras?.shippingCost,
            taxAmount: extras?.taxAmount,
            notes: MARKER,
        });
        purchaseOrderIds.push(po.id);

        await PurchaseOrderService.receivePurchaseOrder(actingUserId, po.id, {
            warehouseId: warehouse.id,
            items: [{ purchaseOrderItemId: po.items[0].id, quantity: receiveQuantity }],
        });

        return po;
    };

    try {
        console.log("\n--- cost basis write-back (database) ---");

        // ---- weighted average over existing stock ----------------------------
        const averaged = await createProduct("averaged", 500, 90, 10, taxRule?.id ?? null);
        productIds.push(averaged.id);
        await orderAndReceive(averaged.id, undefined, 10, 110, 10);
        const averagedAfter = await prisma.product.findUniqueOrThrow({
            where: { id: averaged.id },
            select: { purchasePrice: true, stockQuantity: true },
        });
        check(
            "receipt averages 10 @ 90 with 10 @ 110 to 100",
            num(averagedAfter.purchasePrice) === 100,
            `purchasePrice = ${num(averagedAfter.purchasePrice)} (expected 100), stock now ${averagedAfter.stockQuantity}`,
        );

        // ---- first receipt onto a null basis ---------------------------------
        const virgin = await createProduct("virgin", 900, null, 0, taxRule?.id ?? null);
        productIds.push(virgin.id);
        await orderAndReceive(virgin.id, undefined, 5, 250, 5);
        const virginAfter = await prisma.product.findUniqueOrThrow({
            where: { id: virgin.id },
            select: { purchasePrice: true },
        });
        check(
            "first receipt onto a null basis takes the landed cost",
            num(virginAfter.purchasePrice) === 250,
            `purchasePrice = ${num(virginAfter.purchasePrice)} (expected 250)`,
        );

        // ---- landed cost reaches the basis through a real receipt ------------
        const landed = await createProduct("landed", 900, null, 0, taxRule?.id ?? null);
        productIds.push(landed.id);
        await orderAndReceive(landed.id, undefined, 10, 100, 10, {
            shippingCost: 100,
            taxAmount: 100,
        });
        const landedAfter = await prisma.product.findUniqueOrThrow({
            where: { id: landed.id },
            select: { purchasePrice: true },
        });
        check(
            "shipping and tax are capitalised into the basis",
            num(landedAfter.purchasePrice) === 120,
            `purchasePrice = ${num(landedAfter.purchasePrice)} (expected 120 = (1000 + 200) / 10)`,
        );

        // ---- a variant line updates the variant, not its product -------------
        const parent = await createProduct("variant-parent", 700, 90, 0, taxRule?.id ?? null);
        productIds.push(parent.id);
        const variant = await prisma.productVariant.create({
            data: {
                productId: parent.id,
                name: `${MARKER} variant`,
                sku: `${MARKER}-VAR-${Math.random().toString(36).slice(2, 8)}`,
                stockQuantity: 0,
            },
        });
        await orderAndReceive(parent.id, variant.id, 4, 200, 4);
        const variantAfter = await prisma.productVariant.findUniqueOrThrow({
            where: { id: variant.id },
            select: { purchasePrice: true },
        });
        const parentAfter = await prisma.product.findUniqueOrThrow({
            where: { id: parent.id },
            select: { purchasePrice: true },
        });
        check(
            "a variant line writes the variant's basis",
            num(variantAfter.purchasePrice) === 200,
            `variant purchasePrice = ${num(variantAfter.purchasePrice)} (expected 200)`,
        );
        check(
            "a variant line leaves its product's basis alone",
            num(parentAfter.purchasePrice) === 90,
            `product purchasePrice = ${num(parentAfter.purchasePrice)} (expected 90, unchanged)`,
        );

        // ---- a receipt above the selling price still succeeds ----------------
        const dear = await createProduct("dear", 100, null, 0, taxRule?.id ?? null);
        productIds.push(dear.id);
        await orderAndReceive(dear.id, undefined, 2, 115, 2);
        const dearAfter = await prisma.product.findUniqueOrThrow({
            where: { id: dear.id },
            select: { purchasePrice: true, stockQuantity: true },
        });
        check(
            "a receipt pricing an item above its offer price is not rejected",
            num(dearAfter.purchasePrice) === 115 && dearAfter.stockQuantity === 2,
            `purchasePrice = ${num(dearAfter.purchasePrice)} (expected 115), stock = ${dearAfter.stockQuantity} (expected 2)`,
        );

        console.log("\n--- order cost snapshot (database) ---");

        // ---- placement captures the basis, later receipts do not move it -----
        const sold = await createProduct("sold", 500, null, 0, taxRule?.id ?? null);
        productIds.push(sold.id);
        // Stock (and a basis of 150) arrives the only way it can — through a receipt.
        await orderAndReceive(sold.id, undefined, 10, 150, 10);

        const { order } = await OrderService.placeOrder(
            { kind: "guest", ip: "127.0.0.1" },
            {
                fullName: `${MARKER} buyer`,
                phone: `0170000${Math.floor(1000 + Math.random() * 8999)}`,
                paymentMethod: "COD",
                deliveryOptionKey,
                shippingAddress: { addressLine1: `${MARKER} road`, city: "Dhaka" },
                items: [{ productId: sold.id, quantity: 1 }],
            },
        );
        orderIds.push(order.id);

        const placedItem = await prisma.orderItem.findFirstOrThrow({
            where: { orderId: order.id },
            select: { unitCost: true, unitPrice: true },
        });
        check(
            "placement snapshots the cost basis onto the order line",
            num(placedItem.unitCost) === 150,
            `unitCost = ${num(placedItem.unitCost)} (expected 150), unitPrice = ${num(placedItem.unitPrice)}`,
        );

        check(
            "cost is withheld from the shopper's own checkout response",
            (order.items as Record<string, unknown>[]).every((item) => !("unitCost" in item)),
            "no order item in the checkout response carries unitCost",
        );

        // A second receipt at a different price moves the basis...
        await orderAndReceive(sold.id, undefined, 10, 250, 10);
        const soldAfter = await prisma.product.findUniqueOrThrow({
            where: { id: sold.id },
            select: { purchasePrice: true },
        });
        const placedItemAfter = await prisma.orderItem.findFirstOrThrow({
            where: { orderId: order.id },
            select: { unitCost: true },
        });
        // 9 units left on hand at 150 (checkout took one of the ten), averaged
        // with 10 arriving at 250: (9 × 150 + 10 × 250) / 19 = 202.63.
        check(
            "a later receipt moves the product's basis",
            num(soldAfter.purchasePrice) === 202.63,
            `purchasePrice = ${num(soldAfter.purchasePrice)} (expected 202.63)`,
        );
        check(
            "...but leaves the already-placed order's cost alone",
            num(placedItemAfter.unitCost) === 150,
            `unitCost = ${num(placedItemAfter.unitCost)} (expected 150, unchanged)`,
        );
    } finally {
        const orderItemIds = (
            await prisma.orderItem.findMany({
                where: { orderId: { in: orderIds } },
                select: { id: true },
            })
        ).map((row) => row.id);

        await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

        await prisma.purchaseOrderItem.deleteMany({
            where: { purchaseOrderId: { in: purchaseOrderIds } },
        });
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: purchaseOrderIds } } });

        await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.stock.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.product.deleteMany({ where: { id: { in: productIds } } });

        // Scoped to the entity ids this run created — never to `userId`, which
        // would wipe that user's real audit trail.
        await prisma.auditLog.deleteMany({
            where: { entityId: { in: [...purchaseOrderIds, ...orderIds, ...orderItemIds] } },
        });
        await prisma.notification.deleteMany({ where: { message: { contains: MARKER } } });
        await prisma.supplier.delete({ where: { id: supplier.id } });

        console.log("\nCleaned up verification data.");
    }

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    process.exitCode = failures === 0 ? 0 : 1;
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
