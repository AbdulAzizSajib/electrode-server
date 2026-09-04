import z from "zod";

const shipmentStatusEnum = z.enum([
    "PENDING",
    "PROCESSING",
    "SHIPPED",
    "IN_TRANSIT",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "FAILED",
    "RETURNED",
]);

export const createShipmentZodSchema = z.object({
    trackingNumber: z.string().max(100).optional(),
    carrier: z.string().max(100).optional(),
    status: shipmentStatusEnum.optional(),
});

export const updateShipmentZodSchema = z.object({
    trackingNumber: z.string().max(100).optional(),
    carrier: z.string().max(100).optional(),
    status: shipmentStatusEnum.optional(),
    shippedAt: z.iso.datetime().optional(),
    deliveredAt: z.iso.datetime().optional(),
});
