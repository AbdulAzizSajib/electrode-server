/**
 * Verifies the return guards from `add-admin-correction-paths` group 1.
 *
 * Two bugs are covered, both of which were silent:
 *
 *  1. **Double restock.** The only protection was `existing.status !==
 *     COMPLETED`, and the admin offered every status with no forward-only
 *     constraint — so COMPLETED -> APPROVED -> COMPLETED restocked the same
 *     physical goods twice, inventing inventory the storefront would then sell.
 *     Terminal statuses now refuse the move back.
 *
 *  2. **The two completion paths disagreeing.** Completing a return directly
 *     demanded a warehouse and restocked; completing it as a side effect of a
 *     refund supplied neither and restocked nothing — the same terminal status
 *     meaning opposite things about the shelf. The refund path now states
 *     which happened, and restocks through the same code when it did.
 *
 * The assertions that matter are about CONSERVATION: completing a return adds
 * the returned units exactly once, and a refund that says the goods came back
 * adds them exactly as direct completion would.
 *
 * NOT read-only: creates a warehouse, product, customer, order and returns, all
 * prefixed `VERIFY-RETURN-TRANS`, and removes them in a `finally` so a failure
 * part-way through still leaves the database as it found it.
 *
 * Run with: npx tsx scripts/verify-return-transitions.ts
 */
import {
    OrderStatus,
    ProductStatus,
    ReturnStatus,
    StockMovementType,
} from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { ReturnService } from "../src/app/module/return/return.service";
import { RefundService } from "../src/app/module/refund/refund.service";

const MARKER = "VERIFY-RETURN-TRANS";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const expectRejection = async (label: string, run: () => Promise<unknown>) => {
    try {
        await run();
        check(label, false, "expected a rejection, but the call succeeded");
    } catch (error) {
        check(label, true, `rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
};

const variantStock = async (variantId: string) =>
    (
        await prisma.productVariant.findUniqueOrThrow({
            where: { id: variantId },
            select: { stockQuantity: true },
        })
    ).stockQuantity;

async function main() {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) throw new Error("No user to attribute the audit log entry to.");

    const warehouse = await prisma.warehouse.create({
        data: { name: `${MARKER} Warehouse`, code: `${MARKER}-WH` },
    });

    const product = await prisma.product.create({
        data: {
            name: `${MARKER} Product`,
            slug: `${MARKER.toLowerCase()}-product`,
            sku: `${MARKER}-SKU`,
            offerPrice: 100,
            status: ProductStatus.ACTIVE,
            variants: { create: [{ name: "Only", sku: `${MARKER}-VAR` }] },
        },
        include: { variants: true },
    });
    const variant = product.variants[0];

    const customer = await prisma.customer.create({
        data: { firstName: MARKER, lastName: "Customer", phone: `${MARKER}-PHONE` },
    });

    /** One order with one line of 5 units, and a return for 2 of them. */
    const makeOrderWithReturn = async (suffix: string, returnStatus: ReturnStatus) => {
        const order = await prisma.order.create({
            data: {
                orderNumber: `${MARKER}-ORD-${suffix}`,
                customerId: customer.id,
                status: OrderStatus.DELIVERED,
                subtotal: 500,
                totalAmount: 500,
                items: {
                    create: [
                        {
                            productId: product.id,
                            variantId: variant.id,
                            productName: product.name,
                            quantity: 5,
                            unitPrice: 100,
                            totalPrice: 500,
                        },
                    ],
                },
            },
            include: { items: true },
        });

        const returnRequest = await prisma.returnRequest.create({
            data: {
                returnNumber: `${MARKER}-RET-${suffix}`,
                orderId: order.id,
                customerId: customer.id,
                reason: "Verification",
                status: returnStatus,
                items: { create: [{ orderItemId: order.items[0].id, quantity: 2 }] },
            },
        });

        return { order, returnRequest };
    };

    // ---- 1. terminal statuses ----

    const { returnRequest: completed } = await makeOrderWithReturn("A", ReturnStatus.RECEIVED);

    const before = await variantStock(variant.id);
    await ReturnService.updateReturnStatus(user.id, completed.id, {
        status: ReturnStatus.COMPLETED,
        warehouseId: warehouse.id,
    });
    const afterFirst = await variantStock(variant.id);

    check(
        "completing a return restocks it once",
        afterFirst === before + 2,
        `variant stock ${before} -> ${afterFirst}, expected +2`,
    );

    await expectRejection("refuses to move a COMPLETED return back to APPROVED", () =>
        ReturnService.updateReturnStatus(user.id, completed.id, { status: ReturnStatus.APPROVED }),
    );

    await expectRejection("refuses to re-complete a COMPLETED return", () =>
        ReturnService.updateReturnStatus(user.id, completed.id, {
            status: ReturnStatus.COMPLETED,
            warehouseId: warehouse.id,
        }),
    );

    const afterAttempts = await variantStock(variant.id);
    check(
        "the refused attempts added no stock",
        afterAttempts === afterFirst,
        `variant stock ${afterFirst} -> ${afterAttempts}, expected unchanged`,
    );

    const detail = await prisma.returnRequest.findUniqueOrThrow({ where: { id: completed.id } });
    check(
        "a COMPLETED return offers no onward transition",
        ReturnService.allowedReturnTransitions(detail.status).length === 0,
        `allowed from COMPLETED: [${ReturnService.allowedReturnTransitions(detail.status).join(", ")}]`,
    );

    await expectRejection("refuses an illegal forward jump (REQUESTED -> COMPLETED)", async () => {
        const { returnRequest } = await makeOrderWithReturn("B", ReturnStatus.REQUESTED);
        return ReturnService.updateReturnStatus(user.id, returnRequest.id, {
            status: ReturnStatus.COMPLETED,
            warehouseId: warehouse.id,
        });
    });

    // ---- 2. the refund path ----

    const { order: orderC, returnRequest: returnC } = await makeOrderWithReturn(
        "C",
        ReturnStatus.RECEIVED,
    );

    const beforeRefundRestock = await variantStock(variant.id);
    await RefundService.createRefund(user.id, orderC.id, {
        amount: 200,
        returnRequestId: returnC.id,
        restockWarehouseId: warehouse.id,
    });
    const afterRefundRestock = await variantStock(variant.id);

    const refundedReturn = await prisma.returnRequest.findUniqueOrThrow({ where: { id: returnC.id } });
    check(
        "a refund that says the goods came back completes the return AND restocks",
        refundedReturn.status === ReturnStatus.COMPLETED && afterRefundRestock === beforeRefundRestock + 2,
        `status ${refundedReturn.status}, variant stock ${beforeRefundRestock} -> ${afterRefundRestock} (expected +2)`,
    );

    const { order: orderD, returnRequest: returnD } = await makeOrderWithReturn(
        "D",
        ReturnStatus.RECEIVED,
    );

    const beforeKeepGoods = await variantStock(variant.id);
    await RefundService.createRefund(user.id, orderD.id, { amount: 200, returnRequestId: returnD.id });
    const afterKeepGoods = await variantStock(variant.id);

    const keptReturn = await prisma.returnRequest.findUniqueOrThrow({ where: { id: returnD.id } });
    check(
        "a refund for goods the customer keeps completes the return WITHOUT restocking",
        keptReturn.status === ReturnStatus.COMPLETED && afterKeepGoods === beforeKeepGoods,
        `status ${keptReturn.status}, variant stock ${beforeKeepGoods} -> ${afterKeepGoods} (expected unchanged)`,
    );

    await expectRejection("refuses a restock warehouse with no return to restock", () =>
        RefundService.createRefund(user.id, orderD.id, { amount: 10, restockWarehouseId: warehouse.id }),
    );

    // Both restocking paths must be attributable to the return that caused them.
    const movements = await prisma.stockMovement.findMany({
        where: { productId: product.id, type: StockMovementType.RETURN },
        select: { referenceId: true, quantity: true },
    });
    check(
        "each restock is attributed to its return",
        movements.length === 2 &&
            movements.every((m) => m.referenceId === completed.id || m.referenceId === returnC.id),
        `${movements.length} RETURN movement(s), referenceIds [${movements.map((m) => m.referenceId).join(", ")}]`,
    );

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    if (failures > 0) process.exitCode = 1;
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        const orders = await prisma.order.findMany({
            where: { orderNumber: { contains: MARKER } },
            select: { id: true },
        });
        const orderIds = orders.map((o) => o.id);
        const products = await prisma.product.findMany({
            where: { sku: { contains: MARKER } },
            select: { id: true },
        });
        const productIds = products.map((p) => p.id);

        /*
         * Order matters. `ReturnItem.orderItemId` is RESTRICT, not cascade, so
         * deleting an Order while a ReturnItem still points at one of its
         * OrderItems fails — the returns must go first, and they cascade their
         * own items. Stock and StockMovement do not cascade from Product
         * either, so they go explicitly.
         */
        await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.stock.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.product.deleteMany({ where: { id: { in: productIds } } });
        await prisma.customer.deleteMany({ where: { phone: { contains: MARKER } } });
        await prisma.warehouse.deleteMany({ where: { code: { contains: MARKER } } });
        await prisma.$disconnect();
    });
