import z from "zod";

export const addCartItemZodSchema = z.object({
    productId: z.string(),
    variantId: z.string().optional(),
    quantity: z.number().int().positive().max(999).optional(),
});

export const updateCartItemZodSchema = z.object({
    quantity: z.number().int().positive().max(999),
});
