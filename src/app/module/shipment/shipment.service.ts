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

/**
 * The fields a courier owns once a consignment exists.
 *
 * They are derived from Steadfast by the webhook and the reconciliation job, so
 * a hand-edit here would be undone by the next notification. Left open, an
 * operator's correction and the sync overwrite each other in turn and the panel
 * shows whichever wrote last — a record that disagrees with both the courier and
 * the operator. A control that visibly refuses is better than one that silently
 * undoes itself.
 * See openspec/changes/add-steadfast-courier-integration, design.md Decision 8.
 */
const COURIER_OWNED_FIELDS = [
    "trackingNumber",
    "carrier",
    "status",
    "shippedAt",
    "deliveredAt",
] as const;

const assertNotCourierOwned = (
    shipment: { consignmentId: string | null },
    payload: IUpdateShipmentPayload,
) => {
    if (!shipment.consignmentId) return;

    // `undefined` means "not mentioned" and is fine — a request that touches
    // only untouched fields is not an attempt to edit a courier-owned one.
    const attempted = COURIER_OWNED_FIELDS.filter(
        (field) => payload[field] !== undefined,
    );

    if (attempted.length === 0) return;

    throw new AppError(
        status.CONFLICT,
        `This shipment is managed by the courier (consignment ${shipment.consignmentId}). ${attempted.join(", ")} ${attempted.length === 1 ? "is" : "are"} set from Steadfast and cannot be edited here.`,
    );
};

const createShipment = async (orderId: string, payload: ICreateShipmentPayload) => {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
        throw new AppError(status.NOT_FOUND, "Order not found");
    }

    const existing = await getLatestShipment(orderId);
    if (existing) {
        // A dispatched order lands here too, and says so specifically: "already
        // has a shipment" is true but unhelpful when the reason is that it is
        // already with the courier.
        if (existing.consignmentId) {
            throw new AppError(
                status.CONFLICT,
                `This order has already been dispatched to the courier (consignment ${existing.consignmentId}).`,
            );
        }

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

    // A shipment with no consignment keeps every capability it has today,
    // including the three-state timestamp clearing below.
    assertNotCourierOwned(shipment, payload);

    const { shippedAt, deliveredAt, ...rest } = payload;

    /*
     * Three cases, not two: absent leaves the value alone, null clears it, a
     * date sets it. The previous `value ? new Date(value) : undefined` collapsed
     * the first two — anything falsy became "leave alone" — so a `deliveredAt`
     * stamped on the wrong order could never be removed.
     */
    const timestamp = (value: string | null | undefined) =>
        value === undefined ? undefined : value === null ? null : new Date(value);

    return prisma.shipment.update({
        where: { id: shipment.id },
        data: {
            ...rest,
            shippedAt: timestamp(shippedAt),
            deliveredAt: timestamp(deliveredAt),
        },
    });
};

export const ShipmentService = {
    getOrderShipment,
    createShipment,
    updateShipment,
};
