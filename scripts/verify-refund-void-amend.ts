/**
 * Verifies refund voiding and amendment (`add-admin-correction-paths` group 4).
 *
 * A refund was create-and-list only: a mistyped amount was permanent, and a
 * compensating second refund is impossible because amounts must be positive.
 * The admin client documented the absence as deliberate.
 *
 * Issuing a refund is a compound action — it moves the `Payment` status,
 * completes the `ReturnRequest` it settles, and moves the product's sold count.
 * So the assertion that matters is that voiding reverses ALL of it, and puts
 * each record back to what it WAS rather than to a fixed status:
 *
 *  - a return already `COMPLETED` for its own reasons must not be reopened
 *  - a payment refunded from `PENDING` must not come back as `PAID`
 *
 * Both cases are exercised below, because a void that restored fixed statuses
 * passes a single happy-path check and corrupts every other shape.
 *
 * NOT read-only: creates products, customers, orders, payments and returns
 * prefixed `VERIFY-REFUND-VOID`, and removes them in a `finally`.
 *
 * Run with: npx tsx scripts/verify-refund-void-amend.ts
 */
import {
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
    ProductStatus,
    RefundStatus,
    ReturnStatus,
} from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { RefundService } from "../src/app/module/refund/refund.service";

const MARKER = "VERIFY-REFUND-VOID";

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

    const product = await prisma.product.create({
        data: {
            name: `${MARKER} Product`,
            slug: `${MARKER.toLowerCase()}-product`,
            sku: `${MARKER}-SKU`,
            offerPrice: 100,
            status: ProductStatus.ACTIVE,
            totalSold: 0,
        },
    });

    const customer = await prisma.customer.create({
        data: { firstName: MARKER, lastName: "Customer", phone: `${MARKER}-PHONE` },
    });

    /** One 300-unit order, its payment in `paymentStatus`. */
    const makeOrder = async (suffix: string, paymentStatus: PaymentStatus) => {
        const order = await prisma.order.create({
            data: {
                orderNumber: `${MARKER}-ORD-${suffix}`,
                customerId: customer.id,
                status: OrderStatus.DELIVERED,
                subtotal: 300,
                totalAmount: 300,
                items: {
                    create: [
                        {
                            productId: product.id,
                            productName: product.name,
                            quantity: 3,
                            unitPrice: 100,
                            totalPrice: 300,
                        },
                    ],
                },
            },
            include: { items: true },
        });

        const payment = await prisma.payment.create({
            data: {
                orderId: order.id,
                amount: 300,
                method: PaymentMethod.COD,
                status: paymentStatus,
            },
        });

        return { order, payment };
    };

    const totalSold = async () =>
        (
            await prisma.product.findUniqueOrThrow({
                where: { id: product.id },
                select: { totalSold: true },
            })
        ).totalSold;

    // ---- 1. voiding restores a PAID payment and the sold count ----

    const { order: orderA, payment: paymentA } = await makeOrder("A", PaymentStatus.PAID);
    await prisma.product.update({ where: { id: product.id }, data: { totalSold: 3 } });

    const refundA = await RefundService.createRefund(user.id, orderA.id, {
        amount: 300,
        paymentId: paymentA.id,
    });

    const afterRefund = await prisma.payment.findUniqueOrThrow({ where: { id: paymentA.id } });
    check(
        "issuing the refund settles the payment and reverses the sale",
        afterRefund.status === PaymentStatus.REFUNDED && (await totalSold()) === 0,
        `payment ${afterRefund.status}, totalSold ${await totalSold()}`,
    );

    await RefundService.voidRefund(user.id, refundA.id);

    const voidedA = await prisma.refund.findUniqueOrThrow({ where: { id: refundA.id } });
    const restoredPayment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentA.id } });
    check(
        "voiding restores the payment status and the sold count",
        voidedA.status === RefundStatus.CANCELLED &&
            restoredPayment.status === PaymentStatus.PAID &&
            (await totalSold()) === 3,
        `refund ${voidedA.status}, payment ${restoredPayment.status}, totalSold ${await totalSold()}`,
    );

    check(
        "the voided refund is kept, not deleted — the money is still in history",
        voidedA.id === refundA.id,
        `refund row ${voidedA.id} still present with status ${voidedA.status}`,
    );

    await expectRejection("refuses to void the same refund twice", () =>
        RefundService.voidRefund(user.id, refundA.id),
    );

    // ---- 2. it restores what WAS, not a fixed status ----

    // A payment refunded straight from PENDING never counted a sale; voiding
    // must return it to PENDING, not promote it to PAID.
    const { order: orderB, payment: paymentB } = await makeOrder("B", PaymentStatus.PENDING);
    const refundB = await RefundService.createRefund(user.id, orderB.id, {
        amount: 300,
        paymentId: paymentB.id,
    });
    const soldBeforeVoidB = await totalSold();
    await RefundService.voidRefund(user.id, refundB.id);

    const restoredB = await prisma.payment.findUniqueOrThrow({ where: { id: paymentB.id } });
    check(
        "voiding returns a never-PAID payment to PENDING, not to PAID",
        restoredB.status === PaymentStatus.PENDING && (await totalSold()) === soldBeforeVoidB,
        `payment ${restoredB.status} (expected PENDING), totalSold ${await totalSold()} (expected ${soldBeforeVoidB})`,
    );

    // A return already COMPLETED before the refund must not be reopened by
    // voiding it.
    const { order: orderC, payment: paymentC } = await makeOrder("C", PaymentStatus.PAID);
    const alreadyCompleted = await prisma.returnRequest.create({
        data: {
            returnNumber: `${MARKER}-RET-C`,
            orderId: orderC.id,
            customerId: customer.id,
            reason: "Verification",
            status: ReturnStatus.COMPLETED,
            items: { create: [{ orderItemId: orderC.items[0].id, quantity: 1 }] },
        },
    });

    const refundC = await RefundService.createRefund(user.id, orderC.id, {
        amount: 300,
        paymentId: paymentC.id,
        returnRequestId: alreadyCompleted.id,
    });
    await RefundService.voidRefund(user.id, refundC.id);

    const returnAfterVoid = await prisma.returnRequest.findUniqueOrThrow({
        where: { id: alreadyCompleted.id },
    });
    check(
        "voiding does not reopen a return that was already COMPLETED",
        returnAfterVoid.status === ReturnStatus.COMPLETED,
        `return ${returnAfterVoid.status}, expected COMPLETED`,
    );

    // A return the refund DID complete must go back to where it was.
    const { order: orderD, payment: paymentD } = await makeOrder("D", PaymentStatus.PAID);
    const pendingReturn = await prisma.returnRequest.create({
        data: {
            returnNumber: `${MARKER}-RET-D`,
            orderId: orderD.id,
            customerId: customer.id,
            reason: "Verification",
            status: ReturnStatus.RECEIVED,
            items: { create: [{ orderItemId: orderD.items[0].id, quantity: 1 }] },
        },
    });

    const refundD = await RefundService.createRefund(user.id, orderD.id, {
        amount: 300,
        paymentId: paymentD.id,
        returnRequestId: pendingReturn.id,
    });

    const completedByRefund = await prisma.returnRequest.findUniqueOrThrow({
        where: { id: pendingReturn.id },
    });
    await RefundService.voidRefund(user.id, refundD.id);
    const reopened = await prisma.returnRequest.findUniqueOrThrow({ where: { id: pendingReturn.id } });

    check(
        "voiding returns a refund-completed return to its prior status",
        completedByRefund.status === ReturnStatus.COMPLETED &&
            reopened.status === ReturnStatus.RECEIVED,
        `RECEIVED -> ${completedByRefund.status} -> ${reopened.status} (expected back to RECEIVED)`,
    );

    // ---- 3. amending ----

    const { order: orderE, payment: paymentE } = await makeOrder("E", PaymentStatus.PAID);
    const refundE = await RefundService.createRefund(user.id, orderE.id, {
        amount: 300,
        paymentId: paymentE.id,
    });

    // The mistyped-amount case: amending must compare against the order total
    // EXCLUDING the refund being amended, or it blocks on its own figure.
    const amended = await RefundService.updateRefund(user.id, refundE.id, { amount: 30 });
    check(
        "amending a refund's amount succeeds, excluding itself from the total",
        Number(amended.amount) === 30,
        `amount ${amended.amount}, expected 30`,
    );

    await expectRejection("refuses an amendment above what the order was charged", () =>
        RefundService.updateRefund(user.id, refundE.id, { amount: 500 }),
    );

    const afterRefusedAmend = await prisma.refund.findUniqueOrThrow({ where: { id: refundE.id } });
    check(
        "the refused amendment left the refund unchanged",
        Number(afterRefusedAmend.amount) === 30,
        `amount ${afterRefusedAmend.amount}, expected still 30`,
    );

    await RefundService.voidRefund(user.id, refundE.id);
    await expectRejection("refuses to amend a voided refund", () =>
        RefundService.updateRefund(user.id, refundE.id, { amount: 50 }),
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

        // ReturnItem.orderItemId is RESTRICT — returns must go before orders.
        await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.product.deleteMany({ where: { sku: { contains: MARKER } } });
        await prisma.customer.deleteMany({ where: { phone: { contains: MARKER } } });
        await prisma.$disconnect();
    });
