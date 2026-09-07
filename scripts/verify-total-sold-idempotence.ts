/**
 * Verifies that `Product.totalSold` cannot be double-counted across the refund
 * and payment-status paths (`add-admin-correction-paths` task 3.2).
 *
 * The change's proposal predicted a double-count here: `createRefund` wrote
 * `Payment.status = REFUNDED` directly while separately applying its own `-1`,
 * so an admin correcting the payment back to PAID was expected to increment
 * against a decrement the status never recorded.
 *
 * **That drift did not exist.** `createRefund` already guarded its decrement
 * with `status === PAID`, and `updatePaymentStatus` already keyed off the
 * `wasPaid -> isNowPaid` transition — so this sequence was idempotent before
 * the refactor. Reverting it leaves every check below passing.
 *
 * The script is kept as a REGRESSION guard rather than a bug reproduction. The
 * rule now lives in one place (`applyTotalSoldForPaymentTransition`) instead of
 * being duplicated across two files that each wrote `Payment.status`, and these
 * checks are what would catch the duplication coming back — most likely when a
 * second value joins `PAID_PAYMENT_STATUSES`, which its own comment anticipates.
 *
 * Asserted at every step rather than only at the end, so a failure names the
 * step that broke.
 *
 * NOT read-only: creates a product, customer, order and payments prefixed
 * `VERIFY-TOTAL-SOLD`, and removes them in a `finally`.
 *
 * Run with: npx tsx scripts/verify-total-sold-idempotence.ts
 */
import {
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
    ProductStatus,
} from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { PaymentService } from "../src/app/module/payment/payment.service";
import { RefundService } from "../src/app/module/refund/refund.service";

const MARKER = "VERIFY-TOTAL-SOLD";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

async function main() {
    const staff = await prisma.user.findFirst({
        where: { role: { name: { in: ["OWNER", "ADMIN"] } } },
        select: { id: true, role: { select: { name: true } } },
    });
    if (!staff) throw new Error("No OWNER/ADMIN user to act as the staff caller.");
    const role = staff.role.name as never;

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

    const order = await prisma.order.create({
        data: {
            orderNumber: `${MARKER}-ORD`,
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
    });

    const payment = await prisma.payment.create({
        data: {
            orderId: order.id,
            amount: 300,
            method: PaymentMethod.COD,
            status: PaymentStatus.PENDING,
        },
    });

    const totalSold = async () =>
        (
            await prisma.product.findUniqueOrThrow({
                where: { id: product.id },
                select: { totalSold: true },
            })
        ).totalSold;

    // 1. The sale lands.
    await PaymentService.updatePaymentStatus(staff.id, role, order.id, payment.id, {
        status: PaymentStatus.PAID,
    });
    check("paying an order counts the sale", (await totalSold()) === 3, `totalSold ${await totalSold()}, expected 3`);

    // 2. A refund reverses it — and must leave the counter and the payment
    //    status agreeing that the reversal has happened.
    await RefundService.createRefund(staff.id, order.id, { amount: 300, paymentId: payment.id });
    const afterRefund = await totalSold();
    const paymentAfterRefund = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    check(
        "a full refund reverses the sale exactly once",
        afterRefund === 0 && paymentAfterRefund.status === PaymentStatus.REFUNDED,
        `totalSold ${afterRefund} (expected 0), payment ${paymentAfterRefund.status}`,
    );

    // 3. The admin corrects a refund entered in error by putting the payment
    //    back to PAID. This is the step that used to double-count.
    await PaymentService.updatePaymentStatus(staff.id, role, order.id, payment.id, {
        status: PaymentStatus.PAID,
    });
    const afterCorrection = await totalSold();
    check(
        "correcting the payment back to PAID restores the count, not more",
        afterCorrection === 3,
        `totalSold ${afterCorrection}, expected 3`,
    );

    // 4. Refunding again must reverse once more — not twice.
    await RefundService.createRefund(staff.id, order.id, { amount: 300, paymentId: payment.id });
    const afterSecondRefund = await totalSold();
    check(
        "refunding again reverses once, and does not drive the count below zero",
        afterSecondRefund === 0,
        `totalSold ${afterSecondRefund}, expected 0`,
    );

    // 5. Replaying the reversal on an already-REFUNDED payment must be inert —
    //    this is idempotence rather than a guard against a specific caller.
    await PaymentService.updatePaymentStatus(staff.id, role, order.id, payment.id, {
        status: PaymentStatus.REFUNDED,
    });
    const afterReplay = await totalSold();
    check(
        "replaying a reversal moves nothing",
        afterReplay === 0,
        `totalSold ${afterReplay}, expected 0`,
    );

    // 6. And the whole sequence must agree with what the backfill would compute
    //    from order history — the counter's own definition of correct.
    await PaymentService.updatePaymentStatus(staff.id, role, order.id, payment.id, {
        status: PaymentStatus.PAID,
    });
    const finalCount = await totalSold();
    check(
        "the counter ends where order history says it should",
        finalCount === 3,
        `totalSold ${finalCount}, expected 3 (one paid order of 3 units)`,
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

        await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.product.deleteMany({ where: { sku: { contains: MARKER } } });
        await prisma.customer.deleteMany({ where: { phone: { contains: MARKER } } });
        await prisma.$disconnect();
    });
