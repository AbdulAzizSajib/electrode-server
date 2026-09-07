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
    /*
     * Nullable as well as optional, so an omitted field and an explicitly
     * cleared one are different requests. They used to be indistinguishable —
     * both arrived as `undefined`, which Prisma reads as "leave alone" — so a
     * delivery date stamped on the wrong order was permanent.
     */
    shippedAt: z.iso.datetime().nullable().optional(),
    deliveredAt: z.iso.datetime().nullable().optional(),
});
