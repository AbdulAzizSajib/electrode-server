import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { NotificationType, ReturnStatus } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { NotificationService } from "../notification/notification.service";
import { ICreateRefundPayload } from "./refund.interface";

const createRefund = async (orderId: string, payload: ICreateRefundPayload) => {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: { select: { userId: true } } },
    });
    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    if (payload.paymentId) {
        const payment = await prisma.payment.findUnique({ where: { id: payload.paymentId } });
        if (!payment || payment.orderId !== orderId) {
            throw new AppError(status.BAD_REQUEST, "Payment not found for this order");
        }
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
