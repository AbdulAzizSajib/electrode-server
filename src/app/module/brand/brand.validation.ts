import z from "zod";

export const createBrandZodSchema = z.object({
    name: z.string().min(2).max(150),
    slug: z.string().min(2).max(180).optional(),
    description: z.string().max(2000).optional(),
    logo: z.url("Logo must be a valid URL").optional(),
    status: z.boolean().optional(),
});

export const updateBrandZodSchema = z.object({
    name: z.string().min(2).max(150).optional(),
    slug: z.string().min(2).max(180).optional(),
    description: z.string().max(2000).optional(),
    logo: z.url("Logo must be a valid URL").optional(),
    status: z.boolean().optional(),
});

export const bulkCreateBrandsZodSchema = z.object({
    names: z.array(z.string().min(2).max(150)).min(1, "At least one brand name is required").max(200),
});
