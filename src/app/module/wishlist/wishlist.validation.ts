import z from "zod";

export const addWishlistItemZodSchema = z.object({
    // min(1): an empty string would otherwise reach Prisma and come back as a
    // 404 "Product not found" rather than the 400 it actually is.
    productId: z.string().min(1, "productId is required"),
});
