import status from "http-status";
import { RoleName } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import { NotificationType } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CustomerService } from "../customer/customer.service";
import { NotificationService } from "../notification/notification.service";
import { ICreatePaymentPayload } from "./payment.interface";

const isStaffRole = (role: RoleName) =>
    role === RoleName.OWNER || role === RoleName.ADMIN || role === RoleName.STAFF;

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

    const payment = await prisma.payment.create({
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

const getOrderPayments = async (userId: string, role: RoleName, orderId: string) => {
    await assertOrderAccess(userId, role, orderId);

    return prisma.payment.findMany({
        where: { orderId },
        orderBy: { createdAt: "desc" },
    });
};

export const PaymentService = {
    recordPayment,
    getOrderPayments,
};
