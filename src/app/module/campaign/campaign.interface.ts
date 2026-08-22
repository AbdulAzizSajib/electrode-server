export interface ICampaignProductInput {
    productId: string;
    discountType: "PERCENTAGE" | "FIXED";
    discountValue: number;
}

export interface ICreateCampaignPayload {
    name: string;
    description?: string;
    status?: "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
    startsAt?: string;
    endsAt?: string;
    products?: ICampaignProductInput[];
}

export type IUpdateCampaignPayload = Partial<ICreateCampaignPayload>;

/** One product's best active-campaign discount, resolved by `CampaignService.getActiveDiscountsForProducts`. */
export interface IActiveCampaignDiscount {
    campaignId: string;
    campaignName: string;
    discountType: "PERCENTAGE" | "FIXED";
    discountValue: number;
}
