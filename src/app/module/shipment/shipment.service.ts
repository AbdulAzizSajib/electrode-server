import status from "http-status";
import { RoleName } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { CustomerService } from "../customer/customer.service";
import { ICreateShipmentPayload, IUpdateShipmentPayload } from "./shipment.interface";

const isStaffRole = (role: RoleName) =>
    role === RoleName.OWNER || role === RoleName.ADMIN || role === RoleName.STAFF;

const assertOrderAccess = async (userId: string, role: RoleName, orderId: string) => {
    const order = await prisma.order.findUnique({ where: { id: orderId } });

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

/** The order's most recent shipment — this phase treats "the shipment" as one-per-order (no split-shipment support). */
const getLatestShipment = (orderId: string) =>
    prisma.shipment.findFirst({
        where: { orderId },
        orderBy: { createdAt: "desc" },
    });

const getOrderShipment = async (userId: string, role: RoleName, orderId: string) => {
    await assertOrderAccess(userId, role, orderId);

    const shipment = await getLatestShipment(orderId);
    if (!shipment) {
        throw new AppError(status.NOT_FOUND, "This order has no shipment yet");
    }

    return shipment;
};

const createShipment = async (orderId: string, payload: ICreateShipmentPayload) => {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    const existing = await getLatestShipment(orderId);
    if (existing) {
        throw new AppError(
            status.CONFLICT,
            "This order already has a shipment — update it instead of creating another",
        );
    }

    return prisma.shipment.create({
        data: { ...payload, orderId },
    });
};

const updateShipment = async (orderId: string, payload: IUpdateShipmentPayload) => {
    const shipment = await getLatestShipment(orderId);
    if (!shipment) {
        throw new AppError(status.NOT_FOUND, "This order has no shipment yet — create one first");
    }

    const { shippedAt, deliveredAt, ...rest } = payload;

    return prisma.shipment.update({
        where: { id: shipment.id },
        data: {
            ...rest,
            shippedAt: shippedAt ? new Date(shippedAt) : undefined,
            deliveredAt: deliveredAt ? new Date(deliveredAt) : undefined,
        },
    });
};

export const ShipmentService = {
    getOrderShipment,
    createShipment,
    updateShipment,
};
