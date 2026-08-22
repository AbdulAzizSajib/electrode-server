import z from "zod";

export const createAddressZodSchema = z.object({
    type: z.enum(["SHIPPING", "BILLING", "BOTH"]).optional(),
    fullName: z.string().min(2).max(150),
    phone: z.string().min(6).max(20),
    addressLine1: z.string().min(2).max(250),
    addressLine2: z.string().max(250).optional(),
    city: z.string().min(1).max(100),
    state: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
    isDefault: z.boolean().optional(),
});

export const updateAddressZodSchema = z.object({
    type: z.enum(["SHIPPING", "BILLING", "BOTH"]).optional(),
    fullName: z.string().min(2).max(150).optional(),
    phone: z.string().min(6).max(20).optional(),
    addressLine1: z.string().min(2).max(250).optional(),
    addressLine2: z.string().max(250).optional(),
    city: z.string().min(1).max(100).optional(),
    state: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
    isDefault: z.boolean().optional(),
});
