import z from "zod";

const returnItemZodSchema = z.object({
    orderItemId: z.string(),
    quantity: z.number().int().positive(),
    reason: z.string().max(500).optional(),
});

export const createReturnZodSchema = z.object({
    reason: z.string().min(2).max(500),
    description: z.string().max(2000).optional(),
    items: z.array(returnItemZodSchema).min(1),
});

export const updateReturnStatusZodSchema = z.object({
    status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "RECEIVED", "PROCESSING", "COMPLETED", "CANCELLED"]),
    /**
     * Required only when `status` is `COMPLETED` — the warehouse that
     * receives the returned stock (see `api/post-purchase` spec).
     * Enforced in return.service.ts, not here — a top-level `.refine()`
     * would change this schema's type away from `z.ZodObject`, which
     * `validateRequest` requires.
     */
    warehouseId: z.string().optional(),
});
