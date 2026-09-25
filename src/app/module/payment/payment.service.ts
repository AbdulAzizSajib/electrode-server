import status from "http-status";
import { RoleName } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, NotificationType, PaymentStatus, Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { AuditLogService } from "../audit-log/audit-log.service";
import { CustomerService } from "../customer/customer.service";
import { NotificationService } from "../notification/notification.service";
import { OrderService } from "../order/order.service";
import { ICreatePaymentPayload, IUpdatePaymentStatusPayload } from "./payment.interface";

const isStaffRole = (role: RoleName) =>
    role === RoleName.OWNER || role === RoleName.ADMIN || role === RoleName.STAFF;

/**
 * Payment states that mean "the money arrived", and so are the ones
 * `Product.totalSold` counts. A single-element list rather than a bare
 * comparison so the backfill script and this module read the same rule —
 * see `scripts/backfill-total-sold.mjs`.
 */
export const PAID_PAYMENT_STATUSES: PaymentStatus[] = [PaymentStatus.PAID];

const isPaidStatus = (value: PaymentStatus) => PAID_PAYMENT_STATUSES.includes(value);

/**
 * States a previously-PAID payment can move to that mean the sale came undone.
 * `PARTIALLY_REFUNDED` is deliberately absent: the product was still sold, only
 * some money went back, so the unit count is unaffected.
 */
const SALE_REVERSING_STATUSES: PaymentStatus[] = [
    PaymentStatus.REFUNDED,
    PaymentStatus.CANCELLED,
];

/**
 * Applies a signed delta to `Product.totalSold` for every item in one order.
 *
 * Both the increment and the decrement route through here so the two can never
 * disagree about which products or quantities a sale covers. Takes the
 * transaction client rather than the module-level `prisma`: a counter update
 * that commits separately from the payment write that caused it is silent,
 * permanent drift (design.md Decision 3).
 *
 * On the way down the counter is floored at 0 — a negative count would sort a
 * product to the *top* of an ascending "best selling" listing, so this is
 * correctness rather than defensiveness (design.md Decision 2).
 */
/**
 * Moves `Product.totalSold` for a payment whose status is changing from `from`
 * to `to`, and does nothing when that transition does not change whether the
 * sale counts.
 *
 * The payment's own status is the single source of truth here, which is what
 * makes this idempotent: replaying `PAID -> REFUNDED` a second time reads
 * `wasPaid: false` and moves nothing. Every writer that changes a payment's
 * status must go through this rather than pairing its own status write with a
 * bare `applyTotalSoldDelta` — a caller that decrements while ALSO writing
 * `REFUNDED` directly leaves the counter and the status disagreeing about
 * whether the reversal has already happened, and the floor-at-zero clamp below
 * then makes the resulting drift unrecoverable rather than merely wrong.
 */
const applyTotalSoldForPaymentTransition = async (
    tx: Prisma.TransactionClient,
    orderId: string,
    from: PaymentStatus,
    to: PaymentStatus,
) => {
    const wasPaid = isPaidStatus(from);
    const isNowPaid = isPaidStatus(to);

    if (!wasPaid && isNowPaid) {
        await applyTotalSoldDelta(tx, orderId, 1);
        return;
    }

    // Only a payment that had actually been PAID decrements: one refunded
    // straight from PENDING never incremented, and decrementing it would push
    // the counter below the true figure.
    if (wasPaid && SALE_REVERSING_STATUSES.includes(to)) {
        await applyTotalSoldDelta(tx, orderId, -1);
    }
};

const applyTotalSoldDelta = async (
    tx: Prisma.TransactionClient,
    orderId: string,
    sign: 1 | -1,
) => {
    // Sum per product first: one order may list the same product on more than
    // one line (different variants), and two updates to one row inside one
    // transaction would be wasted round trips against a remote database.
    const grouped = await tx.orderItem.groupBy({
        by: ["productId"],
        where: { orderId },
        _sum: { quantity: true },
    });

    for (const { productId, _sum } of grouped) {
        const quantity = _sum.quantity ?? 0;
        if (quantity <= 0) continue;

        if (sign === 1) {
            await tx.product.update({
                where: { id: productId },
                data: { totalSold: { increment: quantity } },
            });
        } else {
            // Floor at zero. Prisma cannot express GREATEST(x - n, 0) in a
            // `decrement`, so the clamp is a conditional update plus a
            // fallback: subtract normally when there is enough to subtract,
            // otherwise pin to 0.
            const updated = await tx.product.updateMany({
                where: { id: productId, totalSold: { gte: quantity } },
                data: { totalSold: { decrement: quantity } },
            });

            if (updated.count === 0) {
                await tx.product.update({
                    where: { id: productId },
                    data: { totalSold: 0 },
                });
            }
        }
    }
};

/** Same ownership rule as OrderService.getOrderById: staff see any order, a customer only their own (404 if not, per api/checkout spec). */
const assertOrderAccess = async (userId: string, role: RoleName, orderId: string) => {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: { select: { userId: true } } },
    });

    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    if (!isStaffRole(role)) {
        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        if (order.customerId !== customer.id) {
            throw new AppError(status.NOT_FOUND, "Order not found");
        }
    }

    return order;
};

const recordPayment = async (
    userId: string,
    role: RoleName,
    orderId: string,
    payload: ICreatePaymentPayload,
) => {
    const order = await assertOrderAccess(userId, role, orderId);

    /*
     * A CUSTOMER MAY NOT DECLARE THEIR OWN PAYMENT SETTLED.
     *
     * This endpoint is open to every role, which was harmless while the only
     * thing a customer could record was a COD row nobody acted on. With
     * advance payment live it is not: a customer posting `{ status: 'PAID' }`
     * against their own order would create a verified-looking payment and
     * release the order to ship, with no staff member ever having looked at a
     * bank statement. That is the entire feature defeated by one request.
     *
     * The status is FORCED rather than the request rejected, so an existing
     * client that sends one keeps working — it simply cannot choose. Staff keep
     * the free choice they had, because `updatePaymentStatus` already trusts
     * them with it and a staff member recording a settled payment is the normal
     * way money collected at the door gets recorded.
     */
    const requestedStatus = isStaffRole(role) ? payload.status : PaymentStatus.PENDING;

    const payment = await prisma.$transaction(async (tx) => {
        const created = await tx.payment.create({
            data: {
                orderId,
                transactionId: payload.transactionId,
                amount: payload.amount ?? Number(order.totalAmount),
                method: payload.method,
                status: requestedStatus,
                gateway: payload.gateway,
                gatewayResponse: payload.gatewayResponse,
                paidAt: payload.paidAt ? new Date(payload.paidAt) : undefined,
            },
        });

        // Creating an already-PAID payment *is* a transition into PAID — a
        // prepaid order arrives settled and never passes through PENDING here.
        // A COD payment is created PENDING at checkout and reaches PAID later,
        // via updatePaymentStatus below.
        if (isPaidStatus(created.status)) {
            await applyTotalSoldDelta(tx, orderId, 1);
        }

        return created;
    });

    if (order.customer.userId) {
        await NotificationService.createNotification(
            order.customer.userId,
            NotificationType.PAYMENT,
            "Payment recorded",
            `A payment of ${payment.amount} was recorded for order ${orderId}.`,
        );
    }

    return payment;
};

/**
 * Moves an existing payment to a new status, maintaining `Product.totalSold`
 * across the transition.
 *
 * This path did not exist before `add-homepage-merchandising-sections`:
 * `recordPayment` only ever created, so a COD payment written as `PENDING` at
 * checkout had no way to become `PAID` — the store could not distinguish a
 * collected parcel from an uncollected one in its payment records.
 *
 * Staff-only. A customer must not be able to declare their own COD payment
 * settled, so this is narrower than the rest of the module.
 *
 * The counter moves on *transitions*, not on calls: marking an already-`PAID`
 * payment `PAID` again is a no-op for `totalSold`, so a retried or duplicated
 * request cannot double-count (design.md Decision 3).
 */
const updatePaymentStatus = async (
    userId: string,
    role: RoleName,
    orderId: string,
    paymentId: string,
    payload: IUpdatePaymentStatusPayload,
) => {
    await assertOrderAccess(userId, role, orderId);

    if (!isStaffRole(role)) {
        throw new AppError(status.FORBIDDEN, "Only staff can update a payment's status");
    }

    return prisma.$transaction(async (tx) => {
        // Read inside the transaction: the previous status is what decides
        // whether the counter moves, so it must not be read from a snapshot
        // taken before another writer could have changed it.
        const existing = await tx.payment.findUnique({ where: { id: paymentId } });

        if (!existing || existing.orderId !== orderId) {
            throw new AppError(status.NOT_FOUND, "Payment not found for this order");
        }

        const wasPaid = isPaidStatus(existing.status);
        const isNowPaid = isPaidStatus(payload.status);

        const updated = await tx.payment.update({
            where: { id: paymentId },
            data: {
                status: payload.status,
                transactionId: payload.transactionId ?? undefined,
                gateway: payload.gateway ?? undefined,
                gatewayResponse: payload.gatewayResponse ?? undefined,
                // Stamp the settlement time when the money arrives and the
                // caller did not supply one, so a collected COD order carries
                // a paidAt like a gateway payment does.
                paidAt: payload.paidAt
                    ? new Date(payload.paidAt)
                    : !wasPaid && isNowPaid
                      ? new Date()
                      : undefined,
            },
        });

        await applyTotalSoldForPaymentTransition(tx, orderId, existing.status, payload.status);

        return updated;
    });
};

/**
 * Every payment on one order, including an advance claim's full detail.
 *
 * The verifier is joined for STAFF CALLERS ONLY, and that split is the reason
 * this is not a bare `findMany`. The admin's claim panel has to name who decided
 * a claim and when — a verification whose actor the panel cannot state is not an
 * audit trail anyone can read — and it cannot get the name from `/users/:id`,
 * which is OWNER/ADMIN only while verifying is open to STAFF. So a STAFF member
 * would see their own decision attributed to nobody.
 *
 * A customer reads the same endpoint for their own order. They are shown the
 * claim and its outcome, which is theirs, and NOT which staff member decided it,
 * which is the merchant's internal business.
 */
const getOrderPayments = async (userId: string, role: RoleName, orderId: string) => {
    await assertOrderAccess(userId, role, orderId);

    return prisma.payment.findMany({
        where: { orderId },
        orderBy: { createdAt: "desc" },
        include: isStaffRole(role)
            ? { verifiedBy: { select: { id: true, name: true, email: true } } }
            : undefined,
    });
};

/**
 * Loads a claim and refuses one that has already been decided.
 *
 * Shared by verify and reject so the two cannot disagree about what "already
 * decided" means. A claim is decided once it leaves PROCESSING: PAID by a
 * verification, FAILED by a rejection. Anything else — a COD row, a gateway
 * payment — is not a claim at all and is refused as such rather than being
 * silently verified into a state its own flow never expected.
 *
 * 409 rather than a silent overwrite, per the spec: re-deciding a decided claim
 * would write a second verification over the first and lose which staff member
 * actually made the call.
 */
const loadUndecidedClaim = async (
    tx: Prisma.TransactionClient,
    orderId: string,
    paymentId: string,
) => {
    const existing = await tx.payment.findUnique({ where: { id: paymentId } });

    if (!existing || existing.orderId !== orderId) {
        throw new AppError(status.NOT_FOUND, "Payment not found for this order");
    }

    if (existing.status !== PaymentStatus.PROCESSING) {
        throw new AppError(
            status.CONFLICT,
            existing.verifiedAt
                ? `This payment was already ${existing.status === PaymentStatus.PAID ? "verified" : "rejected"} on ${existing.verifiedAt.toISOString().slice(0, 10)}.`
                : `Only a claimed advance payment can be decided; this one is ${existing.status}.`,
        );
    }

    return existing;
};

/**
 * Staff confirm that money a shopper claimed to have sent actually arrived.
 *
 * THE HUMAN IS THE VERIFICATION. The merchant reads their own bKash, Nagad or
 * bank statement and matches it against the claim; this records the decision
 * and who made it. Nothing here validates that the money exists, and nothing
 * can — which is why the audit trail naming the actor is not decoration.
 *
 * Deliberately NOT spelled as `updatePaymentStatus(..., { status: PAID })`,
 * although that path exists and is staff-gated. It accepts any status as a free
 * parameter, so "verify" would be indistinguishable from any other status
 * write, and it records no verifier at all. Reuses that function's internals —
 * the `paidAt` stamp and the `totalSold` transition — rather than duplicating
 * them.
 *
 * Releasing the order is implicit: once this row leaves PROCESSING,
 * `OrderService.isAwaitingPaymentVerification` stops matching it and the order
 * may advance. There is no second write to the order, so the two cannot
 * disagree about whether it is released.
 */
const verifyAdvancePayment = async (
    userId: string,
    role: RoleName,
    orderId: string,
    paymentId: string,
) => {
    if (!isStaffRole(role)) {
        throw new AppError(status.FORBIDDEN, "Only staff can verify a payment");
    }

    const { existing, updated } = await prisma.$transaction(async (tx) => {
        const existing = await loadUndecidedClaim(tx, orderId, paymentId);

        const updated = await tx.payment.update({
            where: { id: paymentId },
            data: {
                status: PaymentStatus.PAID,
                verifiedByUserId: userId,
                verifiedAt: new Date(),
                // The money is held to have arrived now. Distinct from
                // `verifiedAt`, which is when a human said so — they coincide
                // here and would not if a gateway ever reported a settlement
                // time of its own.
                paidAt: new Date(),
                /*
                 * A prior rejection's reason is cleared, because the row now
                 * says the opposite. The REASON is not lost: the audit log
                 * below carries both decisions, which is where the history
                 * lives. Leaving it on the row would render as "verified" with
                 * a rejection reason printed beside it.
                 */
                rejectionReason: null,
            },
        });

        await applyTotalSoldForPaymentTransition(tx, orderId, existing.status, PaymentStatus.PAID);

        return { existing, updated };
    });

    /*
     * Audited because this is the decision that lets an order ship. A merchant
     * reviewing a disputed order needs to know which staff member passed it,
     * and — for a claim verified after an earlier rejection — that both things
     * happened, in that order.
     */
    await AuditLogService.record(userId, AuditAction.UPDATE, "Payment", paymentId, {
        oldData: existing,
        // The decision travels INSIDE newData because the audit record takes
        // only the before/after pair. Spelled out rather than left implicit in
        // the status change, so a reader of the trail does not have to know
        // that PAID-with-a-verifier means "a human passed this".
        newData: { ...updated, decision: "VERIFIED", orderId, amount: Number(updated.amount) },
    });

    return updated;
};

/**
 * Staff record that a claimed payment did not arrive.
 *
 * The reason is REQUIRED. A rejection nobody can be told the grounds for is not
 * actionable by the shopper (who cannot correct it), by other staff (who cannot
 * tell a typo'd reference from a fabricated one), or by the merchant reviewing
 * it later. Enforced here as well as in the schema because this is where it
 * matters.
 *
 * The order stays blocked afterwards, by a different rule than before: it is no
 * longer AWAITING verification, it simply has no verified payment. A rejected
 * claim also keeps its `transactionId`, so the same reference cannot be
 * resubmitted until a different admin happens to pass it.
 */
const rejectAdvancePayment = async (
    userId: string,
    role: RoleName,
    orderId: string,
    paymentId: string,
    reason: string,
) => {
    if (!isStaffRole(role)) {
        throw new AppError(status.FORBIDDEN, "Only staff can reject a payment");
    }

    const trimmed = reason.trim();
    if (!trimmed) {
        throw new AppError(
            status.BAD_REQUEST,
            "Give a reason for rejecting this payment — it is what the shopper and the next staff member have to act on.",
        );
    }

    const { existing, updated } = await prisma.$transaction(async (tx) => {
        const existing = await loadUndecidedClaim(tx, orderId, paymentId);

        const updated = await tx.payment.update({
            where: { id: paymentId },
            data: {
                status: PaymentStatus.FAILED,
                verifiedByUserId: userId,
                verifiedAt: new Date(),
                rejectionReason: trimmed,
            },
        });

        /*
         * PROCESSING was never a paid status, so this moves no counter — the
         * call is made anyway rather than skipped, so that every status write
         * in this module goes through the one function that owns `totalSold`.
         * Skipping it here is how the next status added to the flow quietly
         * stops counting.
         */
        await applyTotalSoldForPaymentTransition(tx, orderId, existing.status, PaymentStatus.FAILED);

        return { existing, updated };
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Payment", paymentId, {
        oldData: existing,
        newData: {
            ...updated,
            decision: "REJECTED",
            reason: trimmed,
            orderId,
            amount: Number(updated.amount),
        },
    });

    return updated;
};

/**
 * Every claim still waiting on a decision, newest first.
 *
 * Exists so the queue is not per-order. A merchant with fifty orders a day
 * cannot find the three awaiting verification by opening fifty order pages,
 * and the ones they miss are orders a shopper has already paid for.
 *
 * Served by `Payment_status_createdAt_idx`.
 */
const getPendingVerifications = async (role: RoleName) => {
    if (!isStaffRole(role)) {
        throw new AppError(status.FORBIDDEN, "Only staff can read pending payment verifications");
    }

    return prisma.payment.findMany({
        where: {
            status: PaymentStatus.PROCESSING,
            method: { in: OrderService.ADVANCE_PAYMENT_METHODS },
        },
        orderBy: { createdAt: "desc" },
        include: {
            order: {
                select: {
                    id: true,
                    orderNumber: true,
                    status: true,
                    totalAmount: true,
                    createdAt: true,
                    customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
                },
            },
        },
    });
};

export const PaymentService = {
    recordPayment,
    updatePaymentStatus,
    getOrderPayments,
    verifyAdvancePayment,
    rejectAdvancePayment,
    getPendingVerifications,
    applyTotalSoldDelta,
    /** Every writer that changes a payment's status must move the counter through this — see its doc comment. */
    applyTotalSoldForPaymentTransition,
};
