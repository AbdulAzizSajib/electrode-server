import z from "zod";

/**
 * Both quantities are at least one: an offer requiring nothing bought, or
 * giving nothing away, is not an offer. Prisma cannot express a check
 * constraint, so this is where it holds.
 */
export const createBundleDealZodSchema = z.object({
    name: z.string().min(1, "A bundle deal needs a name").max(120),
    buyQuantity: z.number().int().min(1, "The shopper must buy at least one"),
    freeQuantity: z.number().int().min(1, "The offer must give at least one away"),
});

export const updateBundleDealZodSchema = createBundleDealZodSchema.partial();
