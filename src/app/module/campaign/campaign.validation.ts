import z from "zod";

const campaignProductZodSchema = z.object({
    productId: z.string(),
    discountType: z.enum(["PERCENTAGE", "FIXED"]),
    discountValue: z.number().nonnegative(),
});

const campaignStatusEnum = z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]);

/**
 * Hand-synced with the `CampaignPlacement` enum in prisma/schema/enums.prisma —
 * Zod cannot read a Prisma enum, so the two lists must be changed together.
 *
 * This is the only hand-written copy left: the payload types in
 * campaign.interface.ts derive from the generated enum, so a value added here
 * but not to the schema (or vice versa) surfaces as a type error at the service
 * boundary rather than as a runtime surprise.
 */
export const campaignPlacementEnum = z.enum(["DEAL_OF_WEEK", "FLASH_SALE"]);

/** Query params for the public `GET /campaigns/active`. */
export const activeCampaignQueryZodSchema = z.object({
    placement: campaignPlacementEnum,
});

export const createCampaignZodSchema = z.object({
    name: z.string().min(2).max(200),
    description: z.string().max(2000).optional(),
    status: campaignStatusEnum.optional(),
    placement: campaignPlacementEnum.optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    products: z.array(campaignProductZodSchema).optional(),
});

export const updateCampaignZodSchema = z.object({
    name: z.string().min(2).max(200).optional(),
    description: z.string().max(2000).optional(),
    status: campaignStatusEnum.optional(),
    placement: campaignPlacementEnum.optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    products: z.array(campaignProductZodSchema).optional(),
});
