import z from "zod";

const attributeValueZodSchema = z.object({
    id: z.string().optional(),
    label: z.string().min(1, "A value needs a label").max(100),
    swatch: z.string().max(50).optional(),
});

/**
 * `name` is deliberately unconstrained beyond length: the storefront renders
 * whatever a merchant writes, so supporting a new kind of attribute needs no
 * code change in any repo.
 */
export const createAttributeZodSchema = z.object({
    name: z.string().min(1, "An attribute needs a name").max(100),
    presentation: z.enum(["SWATCH", "LABEL"]).optional(),
    values: z
        .array(attributeValueZodSchema)
        .min(1, "An attribute needs at least one value"),
});

export const updateAttributeZodSchema = createAttributeZodSchema.partial();

/**
 * One value added to an existing attribute.
 *
 * Deliberately not `attributeValueZodSchema`: that one accepts an `id`, which
 * here would read as "update this value" and be ignored. The attribute is taken
 * from the path, so the body is the value and nothing else.
 */
export const createAttributeValueZodSchema = z.object({
    label: z.string().min(1, "A value needs a label").max(100),
    swatch: z.string().max(50).optional(),
});

/** A rename, a recolour, or both. `swatch: null` clears it. */
export const updateAttributeValueZodSchema = z.object({
    label: z.string().min(1, "A value needs a label").max(100).optional(),
    swatch: z.string().max(50).nullable().optional(),
});
