/**
 * Verifies purchase-order line amendment (`add-admin-correction-paths` group 6).
 *
 * A purchase order froze at the first partial receipt — and its line items were
 * never editable even before that, appearing in no update schema. So a wrong
 * quantity discovered mid-delivery had no correction at all, and the only route
 * was a second purchase order that double-counts the commitment to the
 * supplier.
 *
 * The second-order effect is the one worth proving: an order's `totalAmount` is
 * what supplier payments are judged against, so a frozen understated total
 * permanently capped what could legitimately be recorded as paid. The check
 * below raises a total by amendment and confirms a previously-rejected payment
 * then goes through.
 *
 * What must stay immutable is what has ARRIVED — a receipt moved real stock and
 * set a cost basis from what was actually charged. So the refusals matter as
 * much as the successes: a line cannot be reduced below its received quantity,
 * and a line that has received anything cannot be removed.
 *
 * NOT read-only: creates a supplier, warehouse, product and purchase orders
 * prefixed `VERIFY-PO-AMEND`, and removes them in a `finally`.
 *
 * Run with: npx tsx scripts/verify-purchase-order-amend.ts
 */
import {
    ProductStatus,
    PurchaseOrderStatus,
    SupplierPaymentMethod,
} from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { PurchaseOrderService } from "../src/app/module/purchase-order/purchase-order.service";
import { SupplierPaymentService } from "../src/app/module/supplier-payment/supplier-payment.service";

const MARKER = "VERIFY-PO-AMEND";

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
    if (!user) throw new Error("No user to attribute the audit log entries to.");

    const supplier = await prisma.supplier.create({
        data: { name: `${MARKER} Supplier`, phone: `${MARKER}-PHONE` },
    });
    const warehouse = await prisma.warehouse.create({
        data: { name: `${MARKER} Warehouse`, code: `${MARKER}-WH` },
    });
    const product = await prisma.product.create({
        data: {
            name: `${MARKER} Product`,
            slug: `${MARKER.toLowerCase()}-product`,
            sku: `${MARKER}-SKU`,
            offerPrice: 500,
            status: ProductStatus.ACTIVE,
        },
    });

    // ---- 1. amending an order that has already partially received ----

    const order = await PurchaseOrderService.createPurchaseOrder(user.id, {
        supplierId: supplier.id,
        items: [{ productId: product.id, quantity: 10, unitCost: 100 }],
    });

    await PurchaseOrderService.receivePurchaseOrder(user.id, order.id, {
        warehouseId: warehouse.id,
        items: [{ purchaseOrderItemId: order.items[0].id, quantity: 4 }],
    });

    const partiallyReceived = await PurchaseOrderService.getPurchaseOrderById(order.id);
    check(
        "the order is partially received before amendment",
        partiallyReceived.status === PurchaseOrderStatus.PARTIALLY_RECEIVED,
        `status ${partiallyReceived.status}`,
    );

    await expectRejection("PATCH /:id still refuses to edit a receiving order", () =>
        PurchaseOrderService.updatePurchaseOrder(user.id, order.id, { notes: "nope" }),
    );

    // The correction the merchant actually needs: the supplier is sending 6,
    // not the 10 originally ordered, and 4 have already landed.
    const amended = await PurchaseOrderService.amendPurchaseOrderItems(user.id, order.id, {
        items: [{ id: order.items[0].id, productId: product.id, quantity: 6, unitCost: 100 }],
    });

    check(
        "the outstanding quantity can be amended after a partial receipt",
        amended.items[0].quantity === 6 && amended.items[0].receivedQuantity === 4,
        `quantity ${amended.items[0].quantity} (expected 6), received ${amended.items[0].receivedQuantity} (expected 4, untouched)`,
    );
    check(
        "the order total follows the amendment",
        Number(amended.totalAmount) === 600,
        `totalAmount ${amended.totalAmount}, expected 600`,
    );

    await expectRejection("refuses to reduce a line below what already arrived", () =>
        PurchaseOrderService.amendPurchaseOrderItems(user.id, order.id, {
            items: [{ id: order.items[0].id, productId: product.id, quantity: 3, unitCost: 100 }],
        }),
    );

    await expectRejection("refuses to remove a line that has received stock", () =>
        PurchaseOrderService.amendPurchaseOrderItems(user.id, order.id, {
            items: [{ productId: product.id, quantity: 5, unitCost: 50 }],
        }),
    );

    // Amending the remaining quantity down to what arrived should settle the
    // order: the status is a consequence of the quantities, not a fixed value.
    const settled = await PurchaseOrderService.amendPurchaseOrderItems(user.id, order.id, {
        items: [{ id: order.items[0].id, productId: product.id, quantity: 4, unitCost: 100 }],
    });
    check(
        "amending down to the received quantity settles the order",
        settled.status === PurchaseOrderStatus.RECEIVED,
        `status ${settled.status}, expected RECEIVED`,
    );

    // ---- 2. the payment ceiling the frozen total used to impose ----

    const second = await PurchaseOrderService.createPurchaseOrder(user.id, {
        supplierId: supplier.id,
        items: [{ productId: product.id, quantity: 1, unitCost: 100 }],
    });

    // A draft takes no payments — place it first, so the refusal below is
    // genuinely about the amount rather than the status.
    await PurchaseOrderService.updatePurchaseOrder(user.id, second.id, {
        status: PurchaseOrderStatus.ORDERED,
    });

    await expectRejection("a payment above the order total is refused", () =>
        SupplierPaymentService.recordPayment(user.id, second.id, { amount: 250, method: SupplierPaymentMethod.CASH }),
    );

    // The supplier actually invoiced for 3 units. Before this change the total
    // was unamendable, so that payment could never be recorded at all.
    await PurchaseOrderService.amendPurchaseOrderItems(user.id, second.id, {
        items: [{ id: second.items[0].id, productId: product.id, quantity: 3, unitCost: 100 }],
    });

    const payment = await SupplierPaymentService.recordPayment(user.id, second.id, { amount: 250, method: SupplierPaymentMethod.CASH });
    check(
        "raising the total by amendment makes the payment recordable",
        Number(payment.amount) === 250,
        `payment of ${payment.amount} accepted against the amended total`,
    );

    await expectRejection("refuses an amendment below money already paid", () =>
        PurchaseOrderService.amendPurchaseOrderItems(user.id, second.id, {
            items: [{ id: second.items[0].id, productId: product.id, quantity: 1, unitCost: 100 }],
        }),
    );

    // ---- 3. adding a line the supplier shipped but nobody ordered ----

    const withExtra = await PurchaseOrderService.amendPurchaseOrderItems(user.id, second.id, {
        items: [
            { id: second.items[0].id, productId: product.id, quantity: 3, unitCost: 100 },
            { productId: product.id, quantity: 2, unitCost: 50 },
        ],
    });
    check(
        "a line can be added to an existing order",
        withExtra.items.length === 2 && Number(withExtra.totalAmount) === 400,
        `${withExtra.items.length} line(s), total ${withExtra.totalAmount} (expected 2 and 400)`,
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
        const orders = await prisma.purchaseOrder.findMany({
            where: { supplier: { phone: { contains: MARKER } } },
            select: { id: true },
        });
        const orderIds = orders.map((o) => o.id);
        const products = await prisma.product.findMany({
            where: { sku: { contains: MARKER } },
            select: { id: true },
        });
        const productIds = products.map((p) => p.id);

        await prisma.supplierPayment.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.stock.deleteMany({ where: { productId: { in: productIds } } });
        await prisma.product.deleteMany({ where: { id: { in: productIds } } });
        await prisma.supplier.deleteMany({ where: { phone: { contains: MARKER } } });
        await prisma.warehouse.deleteMany({ where: { code: { contains: MARKER } } });
        await prisma.$disconnect();
    });
