import z from "zod";

export const createSupplierZodSchema = z.object({
    name: z.string().min(2).max(150),
    companyName: z.string().max(200).optional(),
    email: z.email("Email must be valid").optional(),
    phone: z.string().max(30).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(150).optional(),
    country: z.string().max(100).optional(),
    isActive: z.boolean().optional(),
});

export const updateSupplierZodSchema = z.object({
    name: z.string().min(2).max(150).optional(),
    companyName: z.string().max(200).optional(),
    email: z.email("Email must be valid").optional(),
    phone: z.string().max(30).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(150).optional(),
    country: z.string().max(100).optional(),
    isActive: z.boolean().optional(),
});
