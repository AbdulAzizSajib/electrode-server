import {
    CampaignPlacement,
    CampaignStatus,
    DiscountType,
} from "../../../generated/prisma/client";

export interface ICampaignProductInput {
    productId: string;
    discountType: DiscountType;
    discountValue: number;
}

/**
 * Payload types derive from the generated Prisma enums rather than repeating
 * them as hand-written string unions.
 *
 * `add-hero-banner-placements` learned this the hard way: widening the Zod enum
 * alone left a third hand-written copy in the interface, and the service
 * signature that derived its parameter type from it stopped accepting the new
 * values — a build break that no test caught. Deriving here means the Zod
 * schema is the only list left to keep in sync by hand, and a drift between it
 * and the schema surfaces as a type error at the service boundary.
 */
export interface ICreateCampaignPayload {
    name: string;
    description?: string;
    status?: CampaignStatus;
    /** Which storefront slot this campaign occupies. Omitted means none. */
    placement?: CampaignPlacement;
    startsAt?: string;
    endsAt?: string;
    products?: ICampaignProductInput[];
}

export type IUpdateCampaignPayload = Partial<ICreateCampaignPayload>;

/** One product's best active-campaign discount, resolved by `CampaignService.getActiveDiscountsForProducts`. */
export interface IActiveCampaignDiscount {
    campaignId: string;
    campaignName: string;
    discountType: DiscountType;
    discountValue: number;
}
