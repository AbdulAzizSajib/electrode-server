import status from "http-status";
import { RoleName } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import { NotificationType, PaymentStatus, Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CustomerService } from "../customer/customer.service";
import { NotificationService } from "../notification/notification.service";
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

    const payment = await prisma.$transaction(async (tx) => {
        const created = await tx.payment.create({
            data: {
                orderId,
                transactionId: payload.transactionId,
                amount: payload.amount ?? Number(order.totalAmount),
                method: payload.method,
                status: payload.status,
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

        if (!wasPaid && isNowPaid) {
            await applyTotalSoldDelta(tx, orderId, 1);
        } else if (wasPaid && SALE_REVERSING_STATUSES.includes(payload.status)) {
            // Only a payment that had actually been PAID decrements: one
            // refunded straight from PENDING never incremented, and
            // decrementing it would push the counter below the true figure.
            await applyTotalSoldDelta(tx, orderId, -1);
        }

        return updated;
    });
};

const getOrderPayments = async (userId: string, role: RoleName, orderId: string) => {
    await assertOrderAccess(userId, role, orderId);

    return prisma.payment.findMany({
        where: { orderId },
        orderBy: { createdAt: "desc" },
    });
};

export const PaymentService = {
    recordPayment,
    updatePaymentStatus,
    getOrderPayments,
    applyTotalSoldDelta,
};
