import z from "zod";

export const addWishlistItemZodSchema = z.object({
    productId: z.string(),
});
