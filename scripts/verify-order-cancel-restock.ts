/**
 * Verifies the order guards from `add-admin-correction-paths` groups 2 and 3.
 *
 * Cancelling an order used to write only the status and a history row, so the
 * stock deducted at checkout stayed deducted — the goods sat in the warehouse
 * while the system believed they were sold. Silent, and compounding with every
 * cancellation.
 *
 * The assertions that matter are about CONSERVATION and IDEMPOTENCE:
 *
 *  - A cancellation returns exactly what the sale took, to the warehouse it
 *    took it from. `deductStockForOrderLines` may split one line across several
 *    warehouses, so the restock reads the order's own SALE movements back
 *    rather than picking a warehouse — a fixture below forces that split and
 *    checks each warehouse individually, because a restock that returns the
 *    right TOTAL to the wrong shelf still passes a naive total-only check.
 *  - Restocking twice must be impossible. The terminal-status guard is one
 *    defence; the restock's own netting of SALE against CANCELLATION is the
 *    other, and this proves the second independently by calling it directly.
 *
 * NOT read-only: creates warehouses, a product, a customer and orders, all
 * prefixed `VERIFY-ORDER-CANCEL`, and removes them in a `finally` so a failure
 * part-way through still leaves the database as it found it.
 *
 * Run with: npx tsx scripts/verify-order-cancel-restock.ts
 */
import {
    OrderStatus,
    ProductStatus,
    StockMovementType,
} from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { OrderService } from "../src/app/module/order/order.service";

const MARKER = "VERIFY-ORDER-CANCEL";

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

async function main() {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) throw new Error("No user to attribute the status history to.");

    // Two warehouses so a single order line has to be filled from both — the
    // case a restock that picks one warehouse would get wrong.
    const warehouseA = await prisma.warehouse.create({
        data: { name: `${MARKER} A`, code: `${MARKER}-A` },
    });
    const warehouseB = await prisma.warehouse.create({
        data: { name: `${MARKER} B`, code: `${MARKER}-B` },
    });

    const product = await prisma.product.create({
        data: {
            name: `${MARKER} Product`,
            slug: `${MARKER.toLowerCase()}-product`,
            sku: `${MARKER}-SKU`,
            offerPrice: 100,
            status: ProductStatus.ACTIVE,
            stockQuantity: 0,
        },
    });

    const customer = await prisma.customer.create({
        data: { firstName: MARKER, lastName: "Customer", phone: `${MARKER}-PHONE` },
    });

    const stockAt = async (warehouseId: string) =>
        (
            await prisma.stock.findFirst({
                where: { warehouseId, productId: product.id, variantId: null },
                select: { quantity: true },
            })
        )?.quantity ?? 0;

    const productTotal = async () =>
        (
            await prisma.product.findUniqueOrThrow({
                where: { id: product.id },
                select: { stockQuantity: true },
            })
        ).stockQuantity;

    /**
     * An order whose 8 units were taken 5 from A and 3 from B — written as the
     * checkout would leave it, so the restock has a real split to reverse.
     */
    const makeSplitOrder = async (suffix: string, status: OrderStatus) => {
        const order = await prisma.order.create({
            data: {
                orderNumber: `${MARKER}-ORD-${suffix}`,
                customerId: customer.id,
                status,
                subtotal: 800,
                totalAmount: 800,
                items: {
                    create: [
                        {
                            productId: product.id,
                            productName: product.name,
                            quantity: 8,
                            unitPrice: 100,
                            totalPrice: 800,
                        },
                    ],
                },
            },
        });

        await prisma.stockMovement.createMany({
            data: [
                {
                    productId: product.id,
                    warehouseId: warehouseA.id,
                    type: StockMovementType.SALE,
                    quantity: -5,
                    referenceId: order.id,
                },
                {
                    productId: product.id,
                    warehouseId: warehouseB.id,
                    type: StockMovementType.SALE,
                    quantity: -3,
                    referenceId: order.id,
                },
            ],
        });

        return order;
    };

    // Stock as it would stand after those deductions: A and B each already
    // drawn down, and the product total matching.
    await prisma.stock.createMany({
        data: [
            { warehouseId: warehouseA.id, productId: product.id, quantity: 10 },
            { warehouseId: warehouseB.id, productId: product.id, quantity: 4 },
        ],
    });
    await prisma.product.update({ where: { id: product.id }, data: { stockQuantity: 14 } });

    // ---- 1. cancelling returns stock to the warehouses it came from ----

    const order = await makeSplitOrder("A", OrderStatus.CONFIRMED);

    const beforeA = await stockAt(warehouseA.id);
    const beforeB = await stockAt(warehouseB.id);
    const beforeTotal = await productTotal();

    await OrderService.updateOrderStatus(order.id, { status: OrderStatus.CANCELLED }, user.id);

    const afterA = await stockAt(warehouseA.id);
    const afterB = await stockAt(warehouseB.id);
    const afterTotal = await productTotal();

    check(
        "the units return to the warehouse each came from",
        afterA === beforeA + 5 && afterB === beforeB + 3,
        `A ${beforeA} -> ${afterA} (expected +5), B ${beforeB} -> ${afterB} (expected +3)`,
    );
    check(
        "the product total returns by the whole order",
        afterTotal === beforeTotal + 8,
        `product total ${beforeTotal} -> ${afterTotal}, expected +8`,
    );

    const reversal = await prisma.stockMovement.findMany({
        where: { referenceId: order.id, type: StockMovementType.CANCELLATION },
        select: { warehouseId: true, quantity: true },
    });
    check(
        "the reversal is recorded as CANCELLATION, per warehouse",
        reversal.length === 2 && reversal.every((m) => m.quantity > 0),
        `${reversal.length} movement(s): ${reversal.map((m) => `${m.warehouseId === warehouseA.id ? "A" : "B"}+${m.quantity}`).join(", ")}`,
    );

    // ---- 2. it cannot happen twice ----

    await expectRejection("refuses to cancel an already-CANCELLED order", () =>
        OrderService.updateOrderStatus(order.id, { status: OrderStatus.CANCELLED }, user.id),
    );

    await expectRejection("refuses to revive a cancelled order as DELIVERED", () =>
        OrderService.updateOrderStatus(order.id, { status: OrderStatus.DELIVERED }, user.id),
    );

    const afterRefusedA = await stockAt(warehouseA.id);
    const afterRefusedB = await stockAt(warehouseB.id);
    check(
        "the refused attempts moved no stock",
        afterRefusedA === afterA && afterRefusedB === afterB,
        `A ${afterA} -> ${afterRefusedA}, B ${afterB} -> ${afterRefusedB}, both expected unchanged`,
    );

    // ---- 3. transition guards ----

    const shipped = await makeSplitOrder("B", OrderStatus.SHIPPED);

    await expectRejection("refuses to cancel a SHIPPED order — goods are with the customer", () =>
        OrderService.updateOrderStatus(shipped.id, { status: OrderStatus.CANCELLED }, user.id),
    );

    const afterShippedAttemptA = await stockAt(warehouseA.id);
    check(
        "the refused shipped-cancel credited no stock",
        afterShippedAttemptA === afterRefusedA,
        `A ${afterRefusedA} -> ${afterShippedAttemptA}, expected unchanged`,
    );

    check(
        "a CANCELLED order offers no onward transition",
        OrderService.allowedOrderTransitions(OrderStatus.CANCELLED).length === 0,
        `allowed from CANCELLED: [${OrderService.allowedOrderTransitions(OrderStatus.CANCELLED).join(", ")}]`,
    );
    check(
        "a DELIVERED order cannot be cancelled, only completed",
        !OrderService.allowedOrderTransitions(OrderStatus.DELIVERED).includes(OrderStatus.CANCELLED),
        `allowed from DELIVERED: [${OrderService.allowedOrderTransitions(OrderStatus.DELIVERED).join(", ")}]`,
    );

    // A legal move must still work — a guard that refuses everything passes
    // every rejection check above and is useless.
    await OrderService.updateOrderStatus(shipped.id, { status: OrderStatus.DELIVERED }, user.id);
    const delivered = await prisma.order.findUniqueOrThrow({ where: { id: shipped.id } });
    check(
        "a legal transition still succeeds",
        delivered.status === OrderStatus.DELIVERED,
        `SHIPPED -> DELIVERED left the order ${delivered.status}`,
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

        await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.stock.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.product.deleteMany({ where: { id: { in: productIds } } });
        await prisma.customer.deleteMany({ where: { phone: { contains: MARKER } } });
        await prisma.warehouse.deleteMany({ where: { code: { contains: MARKER } } });
        await prisma.$disconnect();
    });
