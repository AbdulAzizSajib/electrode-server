import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { NotificationType, PaymentStatus, ReturnStatus } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { NotificationService } from "../notification/notification.service";
import { PaymentService } from "../payment/payment.service";
import { ICreateRefundPayload } from "./refund.interface";

const createRefund = async (orderId: string, payload: ICreateRefundPayload) => {
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
        });
        if (!returnRequest || returnRequest.orderId !== orderId) {
            throw new AppError(status.BAD_REQUEST, "Return request not found for this order");
        }
    }

    const refund = await prisma.$transaction(async (tx) => {
        const created = await tx.refund.create({
            data: {
                orderId,
                paymentId: payload.paymentId,
                amount: payload.amount,
                reason: payload.reason,
            },
        });

        // Compound action, per api/post-purchase spec: issuing a refund for
        // a return moves that return to a terminal state (see
        // refund.interface.ts for why this isn't a persisted FK).
        if (returnRequest && returnRequest.status !== ReturnStatus.COMPLETED) {
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

            // Only a payment that had actually been PAID decrements: one
            // refunded from PENDING never incremented the counter.
            if (refundedPayment.status === PaymentStatus.PAID && isFullRefund) {
                await PaymentService.applyTotalSoldDelta(tx, orderId, -1);
            }
        }

        return created;
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
};
