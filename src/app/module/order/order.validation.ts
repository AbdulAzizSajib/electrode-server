import z from "zod";

export const createOrderZodSchema = z.object({
    shippingAddressId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    notes: z.string().max(1000).optional(),
    expectedTotal: z.number().nonnegative().optional(),
});

export const updateOrderStatusZodSchema = z.object({
    status: z.enum([
        "PENDING",
        "CONFIRMED",
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
        "COMPLETED",
    ]),
    note: z.string().max(500).optional(),
});
