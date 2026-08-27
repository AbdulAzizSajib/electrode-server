import z from "zod";

export const createOrderZodSchema = z.object({
    shippingAddressId: z.string().optional(),
    shippingMethodId: z.string().optional(),
    notes: z.string().max(1000).optional(),
    expectedTotal: z.number().nonnegative().optional(),
});

/**
 * The `Idempotency-Key` header, not a body field — so `validateRequest`
 * (which only ever parses `req.body`) can't reach it; order.controller.ts
 * applies this schema itself.
 *
 * Optional by design: a request without a key is a valid checkout that
 * simply forgoes replay protection, which is what lets an older storefront
 * keep working against a newer server. A key that IS sent must be a UUID —
 * a malformed one is rejected rather than silently stored, since a client
 * sending garbage here isn't getting the protection it thinks it is.
 */
export const idempotencyKeyZodSchema = z.uuid().optional();

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
