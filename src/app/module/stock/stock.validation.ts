import z from "zod";

export const adjustStockZodSchema = z.object({
    quantityDelta: z.number().int().refine((value) => value !== 0, "quantityDelta must not be zero"),
    note: z.string().max(1000).optional(),
});
