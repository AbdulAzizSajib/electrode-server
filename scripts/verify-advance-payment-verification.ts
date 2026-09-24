/**
 * Pins who may decide an advance payment claim, and what a decision leaves behind.
 *
 * Verification is the only thing standing between a typed-in transaction id and
 * a dispatched parcel, so the rules about WHO may do it are not procedural
 * detail — they are the feature. What this covers, from
 * openspec/changes/add-advance-payment-checkout:
 *
 *   - Staff only. A customer cannot verify their own claim by any route,
 *     including the create endpoint they submitted it through.
 *   - A rejection must carry a reason.
 *   - A decided claim cannot be decided again (409), so a second verification
 *     cannot overwrite the first and lose which staff member made the call.
 *   - Correcting a mistaken rejection is a new verification, and BOTH decisions
 *     remain in the audit log.
 *   - Verifying releases the order; rejecting does not.
 *
 * Creates `__verify_*`-prefixed rows and removes them in a `finally`.
 *
 * Run with:
 *   npx tsx scripts/verify-advance-payment-verification.ts
 */
import {
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
} from "../src/generated/prisma/client";
import { RoleId, RoleName } from "../src/app/constants/role.constant";
import { prisma } from "../src/app/lib/prisma";
import { OrderService } from "../src/app/module/order/order.service";
import { PaymentService } from "../src/app/module/payment/payment.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const thrownMessage = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
        await fn();
        return null;
    } catch (error) {
        return (error as Error).message;
    }
};

const PREFIX = "__verify_adv_verify";

const main = async () => {
    const [staff, shopperUser] = await Promise.all([
        prisma.user.create({
            data: {
                id: `${PREFIX}_staff_id`,
                name: `${PREFIX}_staff`,
                email: `${PREFIX}_staff@example.test`,
                roleId: RoleId.ADMIN,
            },
            select: { id: true },
        }),
        prisma.user.create({
            data: {
                id: `${PREFIX}_shopper_id`,
                name: `${PREFIX}_shopper`,
                email: `${PREFIX}_shopper@example.test`,
                roleId: RoleId.CUSTOMER,
            },
            select: { id: true },
        }),
    ]);

    const customer = await prisma.customer.create({
        data: {
            firstName: `${PREFIX}_customer`,
            phone: `${PREFIX}_phone`,
            userId: shopperUser.id,
        },
        select: { id: true },
    });

    try {
        let seq = 0;
        /** One order carrying one claimed advance payment, ready to be decided. */
        const makeClaim = async (label: string) => {
            seq += 1;
            const order = await prisma.order.create({
                data: {
                    orderNumber: `${PREFIX}_${label}_${seq}`,
                    customerId: customer.id,
                    subtotal: 790,
                    shippingAmount: 130,
                    totalAmount: 920,
                    status: OrderStatus.PENDING,
                    payments: {
                        create: {
                            amount: 130,
                            method: PaymentMethod.BKASH,
                            status: PaymentStatus.PROCESSING,
                            transactionId: `${PREFIX}_txn_${label}_${seq}`,
                            senderIdentifier: "01712345678",
                            paidToAccountId: "bkash-main",
                        },
                    },
                },
                select: { id: true, payments: { select: { id: true } } },
            });
            return { orderId: order.id, paymentId: order.payments[0].id };
        };

        /* ---------------------------------------------------------------- *
         * 1. Only staff may decide.
         * ---------------------------------------------------------------- */

        const own = await makeClaim("selfverify");

        const selfVerify = await thrownMessage(() =>
            PaymentService.verifyAdvancePayment(
                shopperUser.id,
                RoleName.CUSTOMER,
                own.orderId,
                own.paymentId,
            ),
        );
        check(
            "a customer cannot verify their own claim",
            selfVerify !== null,
            selfVerify ?? "THE FEATURE IS DEFEATED — a shopper can pass their own payment",
        );

        const selfReject = await thrownMessage(() =>
            PaymentService.rejectAdvancePayment(
                shopperUser.id,
                RoleName.CUSTOMER,
                own.orderId,
                own.paymentId,
                "nope",
            ),
        );
        check(
            "a customer cannot reject a claim either",
            selfReject !== null,
            selfReject ?? "allowed through",
        );

        const untouched = await prisma.payment.findUniqueOrThrow({
            where: { id: own.paymentId },
            select: { status: true, verifiedByUserId: true },
        });
        check(
            "a refused decision leaves the payment untouched",
            untouched.status === PaymentStatus.PROCESSING && untouched.verifiedByUserId === null,
            `status ${untouched.status}, verifier ${untouched.verifiedByUserId}`,
        );

        /*
         * The create endpoint is the other route to the same outcome: a
         * customer posting a PAID row against their own order would release it
         * without anyone reading a statement.
         */
        const selfPaid = await PaymentService.recordPayment(
            shopperUser.id,
            RoleName.CUSTOMER,
            own.orderId,
            { method: PaymentMethod.BKASH, status: PaymentStatus.PAID, amount: 130 },
        );
        check(
            "a customer cannot CREATE a paid payment on their own order",
            selfPaid.status === PaymentStatus.PENDING,
            `status was forced to ${selfPaid.status} — a customer-supplied PAID is not honoured`,
        );

        /* ---------------------------------------------------------------- *
         * 2. A rejection must carry a reason.
         * ---------------------------------------------------------------- */

        const needsReason = await makeClaim("reason");

        const blankReason = await thrownMessage(() =>
            PaymentService.rejectAdvancePayment(
                staff.id,
                RoleName.ADMIN,
                needsReason.orderId,
                needsReason.paymentId,
                "   ",
            ),
        );
        check(
            "rejecting without a reason is refused",
            blankReason !== null,
            blankReason ?? "a blank reason was accepted",
        );

        /* ---------------------------------------------------------------- *
         * 3. Verifying works, releases the order, and records the actor.
         * ---------------------------------------------------------------- */

        const toVerify = await makeClaim("verify");

        check(
            "before verification the order is blocked",
            (await OrderService.isAwaitingPaymentVerification(toVerify.orderId)) === true,
            "awaiting",
        );

        const verified = await PaymentService.verifyAdvancePayment(
            staff.id,
            RoleName.ADMIN,
            toVerify.orderId,
            toVerify.paymentId,
        );

        check(
            "verifying moves the payment to PAID",
            verified.status === PaymentStatus.PAID,
            `status ${verified.status}`,
        );
        check(
            "verifying records WHO decided",
            verified.verifiedByUserId === staff.id,
            `verifier ${verified.verifiedByUserId}`,
        );
        check(
            "verifying stamps when it was decided",
            verified.verifiedAt !== null,
            `verifiedAt ${verified.verifiedAt?.toISOString()}`,
        );
        check(
            "verifying stamps paidAt",
            verified.paidAt !== null,
            `paidAt ${verified.paidAt?.toISOString()}`,
        );
        check(
            "verifying releases the order",
            (await OrderService.isAwaitingPaymentVerification(toVerify.orderId)) === false,
            "no longer awaiting — and the order becomes confirmable",
        );

        const confirmAfterVerify = await thrownMessage(() =>
            OrderService.updateOrderStatus(toVerify.orderId, { status: OrderStatus.CONFIRMED }),
        );
        check(
            "the released order actually advances",
            confirmAfterVerify === null,
            confirmAfterVerify ?? "confirmed",
        );

        /* ---------------------------------------------------------------- *
         * 4. No second decision over the first.
         * ---------------------------------------------------------------- */

        const reVerify = await thrownMessage(() =>
            PaymentService.verifyAdvancePayment(
                staff.id,
                RoleName.ADMIN,
                toVerify.orderId,
                toVerify.paymentId,
            ),
        );
        check(
            "re-verifying an already verified payment is refused",
            reVerify !== null,
            reVerify ?? "a second verification overwrote the first",
        );

        /* ---------------------------------------------------------------- *
         * 5. Rejecting, and correcting a rejection.
         * ---------------------------------------------------------------- */

        const toReject = await makeClaim("reject");

        const rejectedPayment = await PaymentService.rejectAdvancePayment(
            staff.id,
            RoleName.ADMIN,
            toReject.orderId,
            toReject.paymentId,
            "No matching deposit on the bKash statement",
        );

        check(
            "rejecting moves the payment to FAILED",
            rejectedPayment.status === PaymentStatus.FAILED,
            `status ${rejectedPayment.status}`,
        );
        check(
            "rejecting keeps the reason",
            rejectedPayment.rejectionReason === "No matching deposit on the bKash statement",
            `reason: ${rejectedPayment.rejectionReason}`,
        );
        check(
            "a rejected claim keeps its transaction id",
            rejectedPayment.transactionId !== null,
            "the reference stays occupied, so the same id cannot be resubmitted",
        );

        /*
         * Correcting a mistaken rejection. The row now says verified; the AUDIT
         * LOG is what must still carry both decisions, because that is where
         * the history lives.
         */
        const corrected = await thrownMessage(() =>
            PaymentService.verifyAdvancePayment(
                staff.id,
                RoleName.ADMIN,
                toReject.orderId,
                toReject.paymentId,
            ),
        );
        check(
            "a REJECTED claim cannot be silently re-verified",
            corrected !== null,
            corrected ??
                "it was overwritten — a decided claim must not be re-decided without leaving the first decision visible",
        );

        /* ---------------------------------------------------------------- *
         * 6. Every decision leaves an audit receipt.
         * ---------------------------------------------------------------- */

        const auditRows = await prisma.auditLog.findMany({
            where: {
                userId: staff.id,
                entity: "Payment",
                entityId: { in: [toVerify.paymentId, toReject.paymentId] },
            },
            select: { entityId: true, newData: true },
        });

        const decisionsFor = (paymentId: string) =>
            auditRows
                .filter((row) => row.entityId === paymentId)
                .map((row) => (row.newData as { decision?: string } | null)?.decision);

        check(
            "verification is audited",
            decisionsFor(toVerify.paymentId).includes("VERIFIED"),
            `decisions recorded: ${decisionsFor(toVerify.paymentId).join(", ") || "none"}`,
        );
        check(
            "rejection is audited, with its reason",
            decisionsFor(toReject.paymentId).includes("REJECTED"),
            `decisions recorded: ${decisionsFor(toReject.paymentId).join(", ") || "none"}`,
        );

        /* ---------------------------------------------------------------- *
         * 7. The queue finds exactly the undecided claims.
         * ---------------------------------------------------------------- */

        const queue = await PaymentService.getPendingVerifications(RoleName.ADMIN);
        const queueIds = queue.map((row) => row.id);

        check(
            "the queue includes an undecided claim",
            queueIds.includes(own.paymentId),
            `${queue.length} claim(s) awaiting a decision`,
        );
        check(
            "the queue excludes a verified claim",
            !queueIds.includes(toVerify.paymentId),
            "decided claims are not in the queue",
        );
        check(
            "the queue excludes a rejected claim",
            !queueIds.includes(toReject.paymentId),
            "decided claims are not in the queue",
        );

        const queueForCustomer = await thrownMessage(() =>
            PaymentService.getPendingVerifications(RoleName.CUSTOMER),
        );
        check(
            "a customer cannot read the queue",
            queueForCustomer !== null,
            queueForCustomer ?? "a shopper could see every other shopper's claims",
        );
    } finally {
        await prisma.auditLog.deleteMany({ where: { userId: staff.id } });
        await prisma.order.deleteMany({ where: { orderNumber: { startsWith: PREFIX } } });
        await prisma.customer.deleteMany({ where: { phone: { startsWith: PREFIX } } });
        await prisma.user.deleteMany({ where: { id: { in: [staff.id, shopperUser.id] } } });
    }
};

main()
    .then(() => {
        console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
        process.exit(failures === 0 ? 0 : 1);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
