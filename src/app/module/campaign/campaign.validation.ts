import z from "zod";

const campaignProductZodSchema = z.object({
    productId: z.string(),
    discountType: z.enum(["PERCENTAGE", "FIXED"]),
    discountValue: z.number().nonnegative(),
});

const campaignStatusEnum = z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]);

export const createCampaignZodSchema = z.object({
    name: z.string().min(2).max(200),
    description: z.string().max(2000).optional(),
    status: campaignStatusEnum.optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    products: z.array(campaignProductZodSchema).optional(),
});

export const updateCampaignZodSchema = z.object({
    name: z.string().min(2).max(200).optional(),
    description: z.string().max(2000).optional(),
    status: campaignStatusEnum.optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    products: z.array(campaignProductZodSchema).optional(),
});
