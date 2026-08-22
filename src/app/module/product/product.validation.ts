import z from "zod";

const productVariantZodSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(150),
    sku: z.string().min(1).max(100),
    price: z.number().nonnegative().optional(),
    compareAtPrice: z.number().nonnegative().optional(),
    costPrice: z.number().nonnegative().optional(),
    stockQuantity: z.number().int().nonnegative().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    image: z.url("Variant image must be a valid URL").optional(),
    status: z.boolean().optional(),
});

const productImageZodSchema = z.object({
    id: z.string().optional(),
    url: z.url("Image must be a valid URL"),
    altText: z.string().max(200).optional(),
    sortOrder: z.number().int().optional(),
    isPrimary: z.boolean().optional(),
});

const productAttributeZodSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(100),
    value: z.string().min(1).max(200),
});

export const createProductZodSchema = z.object({
    name: z.string().min(2).max(200),
    slug: z.string().min(2).max(220).optional(),
    sku: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    shortDescription: z.string().max(500).optional(),
    type: z.enum(["SIMPLE", "VARIABLE"]).optional(),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
    categoryId: z.string().optional(),
    brandId: z.string().optional(),
    price: z.number().nonnegative(),
    compareAtPrice: z.number().nonnegative().optional(),
    costPrice: z.number().nonnegative().optional(),
    stockQuantity: z.number().int().nonnegative().optional(),
    lowStockThreshold: z.number().int().nonnegative().optional(),
    weight: z.number().nonnegative().optional(),
    isFeatured: z.boolean().optional(),
    seoTitle: z.string().max(200).optional(),
    seoDescription: z.string().max(500).optional(),
    variants: z.array(productVariantZodSchema).optional(),
    images: z.array(productImageZodSchema).optional(),
    attributes: z.array(productAttributeZodSchema).optional(),
});

export const updateProductZodSchema = createProductZodSchema.partial();
