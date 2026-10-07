import z from "zod";

export const addCartItemZodSchema = z.object({
    productId: z.string(),
    variantId: z.string().optional(),
    quantity: z.number().int().positive().max(999).optional(),
});

export const updateCartItemZodSchema = z.object({
    quantity: z.number().int().positive().max(999),
});

/* Abandoned carts — see openspec/changes/add-abandoned-carts-admin. */

export const abandonedCartsQueryZodSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(20),
});

export const deleteCartsZodSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(100),
});

/*
 * The age is a closed set (`GUEST_PURGE_AGE_DAYS`), never any number, so no
 * request can purge guest carts that are minutes old. At least one rule must be
 * chosen: an empty purge would still write an audit record for nothing.
 */
export const purgeCartsZodSchema = z
    .object({
        guestOlderThanDays: z
            .union([z.literal(7), z.literal(30), z.literal(90)])
            .optional(),
        emptyCarts: z.boolean().optional(),
    })
    .refine((body) => body.guestOlderThanDays !== undefined || body.emptyCarts === true, {
        message: "Choose guest carts to purge, empty carts, or both",
    });
