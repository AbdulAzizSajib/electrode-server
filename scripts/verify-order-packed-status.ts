/**
 * Verifies the PACKED fulfilment state from `add-order-fulfillment-documents`.
 *
 * PACKED is the state an order occupies once picked and boxed but still on the
 * premises. Two things about it are easy to get wrong and neither fails loudly:
 *
 *  - **Reachability.** It must be reachable and leavable. This once asserted
 *    the stronger rule that PACKED was reachable ONLY from PROCESSING, which no
 *    longer holds: transitions are unrestricted, so every status reaches every
 *    other and packing order is narrative rather than enforced. What is checked
 *    now is that PACKED participates fully — reached from PENDING and
 *    CONFIRMED, walked back out of — and that a no-op is still refused.
 *  - **Restocking.** Cancelling a PACKED order must credit its stock back,
 *    because nobody has the goods. PACKED is the LAST state where that holds;
 *    getting this wrong strands real inventory the same way the pre-existing
 *    cancel bug did (see verify-order-cancel-restock.ts). This script asserts
 *    the credit actually lands, not merely that the call was accepted. With the
 *    transition map gone, RESTOCKABLE_ON_CANCEL_STATUSES is the only guard left
 *    on that boundary, so this assertion carries more weight than it used to.
 *
 * PROCESSING keeps its direct edge to SHIPPED: packing is a step a merchant MAY
 * record, not one every order is forced through. That is asserted too, since
 * inserting a mandatory state into the middle of fulfilment would break every
 * merchant who does not pack.
 *
 * NOT read-only: creates a warehouse, product, customer and orders prefixed
 * `VERIFY-ORDER-PACKED`, and removes them in a `finally` so a failure part-way
 * through still leaves the database as it found it.
 *
 * Run with: npx tsx scripts/verify-order-packed-status.ts
 */
import {
    OrderStatus,
    ProductStatus,
    StockMovementType,
} from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { OrderService } from "../src/app/module/order/order.service";

const MARKER = "VERIFY-ORDER-PACKED";

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

    const warehouse = await prisma.warehouse.create({
        data: { name: `${MARKER} WH`, code: `${MARKER}-WH` },
    });

    const product = await prisma.product.create({
        data: {
            name: `${MARKER} Product`,
            slug: `${MARKER.toLowerCase()}-product`,
            sku: `${MARKER}-SKU`,
            offerPrice: 100,
            status: ProductStatus.ACTIVE,
            stockQuantity: 50,
        },
    });

    const customer = await prisma.customer.create({
        data: { firstName: MARKER, lastName: "Customer", phone: `${MARKER}-PHONE` },
    });

    await prisma.stock.create({
        data: { warehouseId: warehouse.id, productId: product.id, quantity: 50 },
    });

    const stockOnHand = async () =>
        (
            await prisma.stock.findFirstOrThrow({
                where: { warehouseId: warehouse.id, productId: product.id, variantId: null },
                select: { quantity: true },
            })
        ).quantity;

    /** An order holding 4 units, written as checkout would leave it. */
    const makeOrder = async (suffix: string, status: OrderStatus) => {
        const order = await prisma.order.create({
            data: {
                orderNumber: `${MARKER}-ORD-${suffix}`,
                customerId: customer.id,
                status,
                subtotal: 400,
                totalAmount: 400,
                items: {
                    create: [
                        {
                            productId: product.id,
                            productName: product.name,
                            quantity: 4,
                            unitPrice: 100,
                            totalPrice: 400,
                        },
                    ],
                },
            },
        });

        await prisma.stockMovement.create({
            data: {
                productId: product.id,
                warehouseId: warehouse.id,
                type: StockMovementType.SALE,
                quantity: -4,
                referenceId: order.id,
            },
        });

        return order;
    };

    // ---- 1. PROCESSING -> PACKED -> SHIPPED is the happy path ----

    const packing = await makeOrder("PACK", OrderStatus.PROCESSING);

    await OrderService.updateOrderStatus(packing.id, { status: OrderStatus.PACKED }, user.id);
    const packed = await prisma.order.findUniqueOrThrow({ where: { id: packing.id } });
    check(
        "PROCESSING -> PACKED is accepted",
        packed.status === OrderStatus.PACKED,
        `order left in ${packed.status}`,
    );

    const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: packing.id, toStatus: OrderStatus.PACKED },
        select: { id: true },
    });
    check(
        "the transition is recorded in status history",
        history.length === 1,
        `${history.length} PACKED history row(s), expected 1`,
    );

    await OrderService.updateOrderStatus(packing.id, { status: OrderStatus.SHIPPED }, user.id);
    const shipped = await prisma.order.findUniqueOrThrow({ where: { id: packing.id } });
    check(
        "PACKED -> SHIPPED is accepted",
        shipped.status === OrderStatus.SHIPPED,
        `order left in ${shipped.status}`,
    );

    // ---- 2. an unpicked order may now be packed, and unpacked again ----
    //
    // This section asserted the opposite: PENDING -> PACKED and
    // CONFIRMED -> PACKED were refused because nothing had been picked yet.
    // The forward-only map that refused them was removed on the merchant's
    // instruction — an operator who mis-clicks a status needs a way back, and
    // the map offered none. Packing order is narrative now, not enforced; what
    // still holds is that PACKED carries its stock meaning wherever it is
    // reached from, which section 3 below checks.

    const pending = await makeOrder("PEND", OrderStatus.PENDING);
    await OrderService.updateOrderStatus(pending.id, { status: OrderStatus.PACKED }, user.id);
    const nowPacked = await prisma.order.findUniqueOrThrow({ where: { id: pending.id } });
    check(
        "PENDING -> PACKED is accepted — transitions are unrestricted",
        nowPacked.status === OrderStatus.PACKED,
        `order is ${nowPacked.status}, expected PACKED`,
    );

    // The correction that the whole change exists for: walking a status back.
    await OrderService.updateOrderStatus(pending.id, { status: OrderStatus.PENDING }, user.id);
    const walkedBack = await prisma.order.findUniqueOrThrow({ where: { id: pending.id } });
    check(
        "PACKED -> PENDING walks the mis-click back",
        walkedBack.status === OrderStatus.PENDING,
        `order is ${walkedBack.status}, expected PENDING`,
    );

    const confirmed = await makeOrder("CONF", OrderStatus.CONFIRMED);
    await OrderService.updateOrderStatus(confirmed.id, { status: OrderStatus.PACKED }, user.id);
    const confirmedPacked = await prisma.order.findUniqueOrThrow({ where: { id: confirmed.id } });
    check(
        "CONFIRMED -> PACKED is accepted — transitions are unrestricted",
        confirmedPacked.status === OrderStatus.PACKED,
        `order is ${confirmedPacked.status}, expected PACKED`,
    );

    await expectRejection("still refuses PACKED -> PACKED — a no-op is not a transition", () =>
        OrderService.updateOrderStatus(confirmed.id, { status: OrderStatus.PACKED }, user.id),
    );

    // ---- 3. cancelling a PACKED order credits stock back ----

    const toCancel = await makeOrder("CANC", OrderStatus.PROCESSING);
    await OrderService.updateOrderStatus(toCancel.id, { status: OrderStatus.PACKED }, user.id);

    const beforeCancel = await stockOnHand();
    await OrderService.updateOrderStatus(toCancel.id, { status: OrderStatus.CANCELLED }, user.id);
    const afterCancel = await stockOnHand();

    check(
        "cancelling a PACKED order returns its units to the shelf",
        afterCancel === beforeCancel + 4,
        `stock ${beforeCancel} -> ${afterCancel}, expected +4`,
    );

    const reversal = await prisma.stockMovement.findMany({
        where: { referenceId: toCancel.id, type: StockMovementType.CANCELLATION },
        select: { quantity: true },
    });
    check(
        "the credit is recorded as a CANCELLATION movement",
        reversal.length === 1 && reversal[0].quantity === 4,
        `${reversal.length} movement(s): ${reversal.map((m) => `+${m.quantity}`).join(", ") || "none"}`,
    );

    // ---- 4. the transition map says what the admin should offer ----
    //
    // Transitions are unrestricted: every status but the current one is on
    // offer, in both directions. The forward-only map this section used to
    // assert (PROCESSING -> PACKED, PACKED -> SHIPPED|CANCELLED only, PACKED
    // withheld from PENDING/CONFIRMED) was removed on the merchant's
    // instruction so a mis-clicked status could be walked back. What is checked
    // here now is that PACKED is a first-class status in that set — reachable
    // and leaving — which is what this script exists to prove.

    const fromProcessing = OrderService.allowedOrderTransitions(OrderStatus.PROCESSING);
    check(
        "PROCESSING offers PACKED",
        fromProcessing.includes(OrderStatus.PACKED),
        `allowed from PROCESSING: [${fromProcessing.join(", ")}]`,
    );
    check(
        "PROCESSING still offers SHIPPED — packing is optional, not forced",
        fromProcessing.includes(OrderStatus.SHIPPED),
        `allowed from PROCESSING: [${fromProcessing.join(", ")}]`,
    );

    const fromPacked = OrderService.allowedOrderTransitions(OrderStatus.PACKED);
    check(
        "PACKED leads onward to SHIPPED and out via CANCELLED",
        fromPacked.includes(OrderStatus.SHIPPED) && fromPacked.includes(OrderStatus.CANCELLED),
        `allowed from PACKED: [${fromPacked.join(", ")}]`,
    );
    check(
        "PACKED does not offer itself — updateOrderStatus rejects a no-op separately",
        !fromPacked.includes(OrderStatus.PACKED),
        `allowed from PACKED: [${fromPacked.join(", ")}]`,
    );

    for (const from of [OrderStatus.PENDING, OrderStatus.CONFIRMED] as const) {
        check(
            `${from} offers PACKED — transitions are unrestricted`,
            OrderService.allowedOrderTransitions(from).includes(OrderStatus.PACKED),
            `allowed from ${from}: [${OrderService.allowedOrderTransitions(from).join(", ")}]`,
        );
    }

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
