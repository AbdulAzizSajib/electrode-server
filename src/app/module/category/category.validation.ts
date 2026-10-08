import z from "zod";

export const createCategoryZodSchema = z.object({
    name: z.string().min(2).max(150),
    slug: z.string().min(2).max(180).optional(),
    description: z.string().max(2000).optional(),
    image: z.url("Image must be a valid URL").optional(),
    banner: z.url("Banner must be a valid URL").optional(),
    status: z.boolean().optional(),
    parentId: z.string().optional(),
    seoTitle: z.string().max(200).optional(),
    seoDescription: z.string().max(500).optional(),
    sortOrder: z.number().int().optional(),
});

export const updateCategoryZodSchema = z.object({
    name: z.string().min(2).max(150).optional(),
    slug: z.string().min(2).max(180).optional(),
    description: z.string().max(2000).optional(),
    /*
     * Three states, so `.nullable()`: omitted leaves the artwork alone, a URL
     * replaces it, and `null` REMOVES it. Without null the admin had no way to
     * take an image off a category once set. The service deletes the replaced
     * or removed file from Cloudinary after the save.
     */
    image: z.url("Image must be a valid URL").nullable().optional(),
    banner: z.url("Banner must be a valid URL").nullable().optional(),
    status: z.boolean().optional(),
    parentId: z.string().nullable().optional(),
    seoTitle: z.string().max(200).optional(),
    seoDescription: z.string().max(500).optional(),
    sortOrder: z.number().int().optional(),
});
