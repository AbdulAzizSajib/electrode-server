import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import {
    AuditAction,
    NotificationType,
    PaymentStatus,
    Prisma,
    RefundStatus,
    ReturnStatus,
} from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { NotificationService } from "../notification/notification.service";
import { PaymentService } from "../payment/payment.service";
import { ReturnService } from "../return/return.service";
import { ICreateRefundPayload, IUpdateRefundPayload } from "./refund.interface";

const createRefund = async (
    userId: string,
    orderId: string,
    payload: ICreateRefundPayload,
) => {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: { select: { userId: true } } },
    });
    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    let refundedPayment = null;
    if (payload.paymentId) {
        const payment = await prisma.payment.findUnique({ where: { id: payload.paymentId } });
        if (!payment || payment.orderId !== orderId) {
            throw new AppError(status.BAD_REQUEST, "Payment not found for this order");
        }
        refundedPayment = payment;
    }

    let returnRequest = null;
    if (payload.returnRequestId) {
        returnRequest = await prisma.returnRequest.findUnique({
            where: { id: payload.returnRequestId },
            // Items are needed to restock when the goods came back — see below.
            include: { items: { include: { orderItem: true } } },
        });
        if (!returnRequest || returnRequest.orderId !== orderId) {
            throw new AppError(status.BAD_REQUEST, "Return request not found for this order");
        }
    }

    if (payload.restockWarehouseId) {
        if (!returnRequest) {
            throw new AppError(
                status.BAD_REQUEST,
                "restockWarehouseId only applies to a refund that settles a return — supply returnRequestId too",
            );
        }

        const warehouse = await prisma.warehouse.findUnique({
            where: { id: payload.restockWarehouseId },
            select: { id: true },
        });
        if (!warehouse) {
            throw new AppError(status.BAD_REQUEST, "Warehouse not found");
        }
    }

    // What this refund is about to overwrite, captured before the writes below
    // so voiding can put things back exactly. A void that guessed a fixed
    // status would reopen a return completed for its own reasons, or revive a
    // payment that was never PAID.
    const willCompleteReturn = !!returnRequest && returnRequest.status !== ReturnStatus.COMPLETED;

    const refund = await prisma.$transaction(async (tx) => {
        const created = await tx.refund.create({
            data: {
                orderId,
                paymentId: payload.paymentId,
                amount: payload.amount,
                reason: payload.reason,
                priorPaymentStatus: refundedPayment?.status ?? null,
                priorReturnStatus: willCompleteReturn ? returnRequest!.status : null,
                completedReturnRequestId: willCompleteReturn ? returnRequest!.id : null,
            },
        });

        // Compound action, per api/post-purchase spec: issuing a refund for
        // a return moves that return to a terminal state (see
        // refund.interface.ts for why this isn't a persisted FK).
        //
        // Restocking is now explicit rather than implied by which endpoint was
        // used. Completing a return here used to move it to COMPLETED without
        // ever restocking, while completing it via updateReturnStatus demanded
        // a warehouse and always restocked — the same terminal status meaning
        // opposite things about the shelf. The caller states which happened:
        // a warehouse means the goods came back, its absence means the
        // customer kept them.
        if (returnRequest && returnRequest.status !== ReturnStatus.COMPLETED) {
            if (payload.restockWarehouseId) {
                await ReturnService.restockReturnedItems(
                    tx,
                    returnRequest.id,
                    payload.restockWarehouseId,
                    returnRequest.items.map((item) => ({
                        productId: item.orderItem.productId,
                        variantId: item.orderItem.variantId,
                        quantity: item.quantity,
                    })),
                );
            }

            await tx.returnRequest.update({
                where: { id: returnRequest.id },
                data: { status: ReturnStatus.COMPLETED },
            });
        }

        // Settle the payment the refund came out of. Before
        // add-homepage-merchandising-sections a refund left Payment.status
        // untouched, so a fully refunded order still read as PAID.
        //
        // Full vs partial is decided by amount: a partial refund leaves the
        // sale standing (the customer kept the goods), so it must not undo the
        // product's sales count — only a full refund does.
        if (refundedPayment) {
            const isFullRefund = Number(payload.amount) >= Number(refundedPayment.amount);
            const nextStatus = isFullRefund
                ? PaymentStatus.REFUNDED
                : PaymentStatus.PARTIALLY_REFUNDED;

            await tx.payment.update({
                where: { id: refundedPayment.id },
                data: { status: nextStatus },
            });

            /*
             * Through the shared transition helper, not a bare delta. This used
             * to decrement on its own while writing REFUNDED directly, so the
             * counter and the payment status disagreed about whether the
             * reversal had happened: an admin later correcting the payment back
             * to PAID incremented (correctly, from the status's point of view),
             * and refunding again decremented a second time. The floor-at-zero
             * clamp then made that drift unrecoverable rather than merely wrong.
             *
             * Keying off the payment's own status transition makes the move
             * idempotent — replaying it reads `wasPaid: false` and does nothing.
             */
            await PaymentService.applyTotalSoldForPaymentTransition(
                tx,
                orderId,
                refundedPayment.status,
                nextStatus,
            );
        }

        return created;
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "Refund", refund.id, {
        newData: refund,
    });

    if (order.customer.userId) {
        await NotificationService.createNotification(
            order.customer.userId,
            NotificationType.REFUND,
            "Refund issued",
            `A refund of ${refund.amount} was issued for order ${orderId}.`,
        );
    }

    return refund;
};

/** A refund already voided has nothing left to reverse, and its money no longer stands. */
const assertRefundIsLive = (refund: { status: RefundStatus }) => {
    if (refund.status === RefundStatus.CANCELLED) {
        throw new AppError(status.BAD_REQUEST, "This refund has already been voided");
    }
};

/**
 * Total refunded against an order, excluding one refund — the same
 * exclude-self shape `supplier-payment.service.ts` uses when amending, so an
 * amendment is not blocked by the figure it is replacing.
 */
const sumRefundedExcluding = async (
    tx: Prisma.TransactionClient,
    orderId: string,
    excludeRefundId?: string,
) => {
    const aggregate = await tx.refund.aggregate({
        where: {
            orderId,
            status: { not: RefundStatus.CANCELLED },
            ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}),
        },
        _sum: { amount: true },
    });

    return Number(aggregate._sum.amount ?? 0);
};

/**
 * Voids a refund recorded in error, reversing everything creating it did.
 *
 * The reversal is all-or-nothing by construction: creation moved the refund
 * row, the `Payment` status, the `ReturnRequest` it completed and the product
 * sold counts in one transaction, and a partial unwind would leave those four
 * records disagreeing about one event — worse than the original mistyped
 * amount, because each looks plausible on its own.
 *
 * The related records go back to what they WERE, read from the columns
 * creation recorded, not to a fixed status: a return already `COMPLETED` for
 * its own reasons must not be reopened, and a payment refunded from `PENDING`
 * must not come back as `PAID`. A refund written before those columns existed
 * carries nulls, and then only the refund itself is voided — stated plainly in
 * the result so the operator knows what is left to do by hand.
 *
 * The row is kept and marked `CANCELLED` rather than deleted. A refund that
 * existed is a thing that happened, and the payments report has already shown
 * it; deleting would make the money silently disappear from history.
 */
const voidRefund = async (userId: string, refundId: string) => {
    const existing = await prisma.refund.findUnique({ where: { id: refundId } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Refund not found");
    }

    assertRefundIsLive(existing);

    const voided = await prisma.$transaction(async (tx) => {
        const updated = await tx.refund.update({
            where: { id: refundId },
            data: { status: RefundStatus.CANCELLED },
        });

        // Restore the payment, and move the sold count back through the same
        // transition helper every other writer uses — so the counter and the
        // payment status cannot disagree about whether the sale stands.
        if (existing.paymentId && existing.priorPaymentStatus) {
            const payment = await tx.payment.findUnique({ where: { id: existing.paymentId } });

            if (payment) {
                await tx.payment.update({
                    where: { id: payment.id },
                    data: { status: existing.priorPaymentStatus },
                });

                await PaymentService.applyTotalSoldForPaymentTransition(
                    tx,
                    existing.orderId,
                    payment.status,
                    existing.priorPaymentStatus,
                );
            }
        }

        if (existing.completedReturnRequestId && existing.priorReturnStatus) {
            await tx.returnRequest.update({
                where: { id: existing.completedReturnRequestId },
                data: { status: existing.priorReturnStatus },
            });
        }

        return updated;
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Refund", refundId, {
        oldData: existing,
        newData: voided,
    });

    return voided;
};

/**
 * Corrects a recorded refund's amount or reason.
 *
 * Only the figures are amendable. Which payment a refund came out of, and
 * which return it settled, decide what voiding has to reverse — changing them
 * on a live refund would leave the recorded prior state describing records the
 * refund no longer touches. Void and re-issue instead.
 */
const updateRefund = async (userId: string, refundId: string, payload: IUpdateRefundPayload) => {
    const existing = await prisma.refund.findUnique({ where: { id: refundId } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Refund not found");
    }

    assertRefundIsLive(existing);

    const updated = await prisma.$transaction(async (tx) => {
        if (payload.amount !== undefined) {
            const order = await tx.order.findUniqueOrThrow({
                where: { id: existing.orderId },
                select: { totalAmount: true },
            });

            const otherRefunds = await sumRefundedExcluding(tx, existing.orderId, refundId);
            const orderTotal = Number(order.totalAmount);

            if (otherRefunds + payload.amount > orderTotal) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Refunding ${payload.amount} would take this order's total refunded to ${otherRefunds + payload.amount}, above the ${orderTotal} it was charged`,
                );
            }
        }

        return tx.refund.update({
            where: { id: refundId },
            data: { amount: payload.amount, reason: payload.reason },
        });
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Refund", refundId, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

const getRefunds = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.refund, queryParams, {
        filterableFields: ["status", "orderId", "paymentId"],
    });

    return queryBuilder
        .filter()
        .sort()
        .paginate()
        .include({ order: { select: { id: true, orderNumber: true } } })
        .execute();
};

export const RefundService = {
    createRefund,
    getRefunds,
    updateRefund,
    voidRefund,
};
