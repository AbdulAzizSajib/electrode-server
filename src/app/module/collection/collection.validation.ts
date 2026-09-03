import z from "zod";

export const createCollectionZodSchema = z.object({
    name: z.string().min(1, "A collection needs a name").max(120),
    slug: z.string().max(140).optional(),
    isVisible: z.boolean().optional(),
});

export const updateCollectionZodSchema = createCollectionZodSchema.partial();
