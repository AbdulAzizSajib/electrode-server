import z from "zod";

export const createWarehouseZodSchema = z.object({
    name: z.string().min(2).max(150),
    code: z.string().min(2).max(50),
    address: z.string().max(500).optional(),
    city: z.string().max(150).optional(),
    country: z.string().max(100).optional(),
    isActive: z.boolean().optional(),
});

export const updateWarehouseZodSchema = z.object({
    name: z.string().min(2).max(150).optional(),
    code: z.string().min(2).max(50).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(150).optional(),
    country: z.string().max(100).optional(),
    isActive: z.boolean().optional(),
});
