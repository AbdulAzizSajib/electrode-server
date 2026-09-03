import z from "zod";

const shippingPlaceZodSchema = z.object({
    id: z.string().optional(),
    name: z.string().max(120).optional(),
    country: z.string().max(2).optional(),
    state: z.string().max(100).optional(),
    price: z.number().nonnegative("Shipping cannot cost less than nothing"),
    deliveryDays: z.number().int().nonnegative().optional(),
    offersPickup: z.boolean().optional(),
    pickupPrice: z.number().nonnegative().optional(),
});

export const createShippingRuleZodSchema = z.object({
    name: z.string().min(1, "A shipping rule needs a name").max(100),
    places: z
        .array(shippingPlaceZodSchema)
        .min(1, "A shipping rule needs at least one place"),
});

export const updateShippingRuleZodSchema = createShippingRuleZodSchema.partial();
