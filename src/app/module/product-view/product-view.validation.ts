import z from "zod";

/**
 * The marker is a literal, not a free string: only a product detail page may
 * record a view, and enumerating the one acceptable value here means a new
 * caller has to be added deliberately rather than by passing any label.
 */
export const recordProductViewZodSchema = z.object({
    source: z.literal("product_detail", {
        message: "Only a product detail view can be recorded",
    }),
});
