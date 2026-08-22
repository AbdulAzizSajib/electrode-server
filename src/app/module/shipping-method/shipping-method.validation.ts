import z from "zod";

export const createShippingMethodZodSchema = z.object({
    name: z.string().min(2).max(150),
    description: z.string().max(1000).optional(),
    price: z.number().nonnegative(),
    estimatedDays: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
});

export const updateShippingMethodZodSchema = z.object({
    name: z.string().min(2).max(150).optional(),
    description: z.string().max(1000).optional(),
    price: z.number().nonnegative().optional(),
    estimatedDays: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
});
