import z from "zod";

export const updateStoreSettingZodSchema = z.object({
    storeName: z.string().min(2).max(200).optional(),
    currency: z.string().min(2).max(10).optional(),
    currencySymbol: z.string().min(1).max(10).optional(),
    defaultTaxRatePercent: z.number().min(0).max(100).optional(),
    freeShippingThreshold: z.number().nonnegative().optional(),
    contactEmail: z.email("Contact email must be valid").optional(),
    contactPhone: z.string().max(30).optional(),
    address: z.string().max(500).optional(),
});
