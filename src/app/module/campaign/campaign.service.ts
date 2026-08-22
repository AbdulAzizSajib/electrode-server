import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { CampaignStatus } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { IActiveCampaignDiscount, ICreateCampaignPayload, IUpdateCampaignPayload } from "./campaign.interface";

const CAMPAIGN_INCLUDE = {
    products: { include: { product: { select: { id: true, name: true, slug: true } } } },
};

const createCampaign = async (payload: ICreateCampaignPayload) => {
    const { products, startsAt, endsAt, ...rest } = payload;

    return prisma.campaign.create({
        data: {
            ...rest,
            startsAt: startsAt ? new Date(startsAt) : undefined,
            endsAt: endsAt ? new Date(endsAt) : undefined,
            ...(products && products.length > 0 ? { products: { create: products } } : {}),
        },
        include: CAMPAIGN_INCLUDE,
    });
};

const getAdminCampaigns = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.campaign, queryParams, {
        searchableFields: ["name", "description"],
        filterableFields: ["status"],
    });

    return queryBuilder.search().filter().sort().paginate().include(CAMPAIGN_INCLUDE).execute();
};

const getCampaignOrThrow = async (id: string) => {
    const campaign = await prisma.campaign.findUnique({ where: { id }, include: CAMPAIGN_INCLUDE });

    if (!campaign) {
        throw new AppError(status.NOT_FOUND, "Campaign not found");
    }

    return campaign;
};

const updateCampaign = async (id: string, payload: IUpdateCampaignPayload) => {
    await getCampaignOrThrow(id);

    const { products, startsAt, endsAt, ...rest } = payload;

    return prisma.$transaction(async (tx) => {
        await tx.campaign.update({
            where: { id },
            data: {
                ...rest,
                startsAt: startsAt ? new Date(startsAt) : undefined,
                endsAt: endsAt ? new Date(endsAt) : undefined,
            },
        });

        if (products) {
            await tx.campaignProduct.deleteMany({ where: { campaignId: id } });
            if (products.length > 0) {
                await tx.campaignProduct.createMany({
                    data: products.map((p) => ({ ...p, campaignId: id })),
                });
            }
        }

        return tx.campaign.findUniqueOrThrow({ where: { id }, include: CAMPAIGN_INCLUDE });
    });
};

const deleteCampaign = async (id: string) => {
    await getCampaignOrThrow(id);

    return prisma.campaign.delete({ where: { id } });
};

/**
 * Resolves each product's best (largest) currently-active `CampaignProduct`
 * discount, for `api/catalog`'s public product read endpoints to reflect
 * automatically — per `api/marketing` spec, no separate customer-facing
 * endpoint or customer action is needed. "Best" (rather than stacking) is
 * this implementation's choice for when more than one active campaign
 * targets the same product — the spec doesn't define stacking behavior.
 */
const getActiveDiscountsForProducts = async (
    productIds: string[],
    priceByProductId: Map<string, number>,
): Promise<Map<string, IActiveCampaignDiscount>> => {
    if (productIds.length === 0) {
        return new Map();
    }

    const now = new Date();

    const eligible = await prisma.campaignProduct.findMany({
        where: {
            productId: { in: productIds },
            campaign: {
                status: CampaignStatus.ACTIVE,
                AND: [
                    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
                ],
            },
        },
        include: { campaign: { select: { id: true, name: true } } },
    });

    const bestByProductId = new Map<string, IActiveCampaignDiscount>();

    for (const campaignProduct of eligible) {
        const basePrice = priceByProductId.get(campaignProduct.productId);
        if (basePrice === undefined) {
            continue;
        }

        const candidateResultingPrice =
            campaignProduct.discountType === "PERCENTAGE"
                ? basePrice * (1 - Number(campaignProduct.discountValue) / 100)
                : basePrice - Number(campaignProduct.discountValue);

        const current = bestByProductId.get(campaignProduct.productId);
        const currentResultingPrice = current
            ? current.discountType === "PERCENTAGE"
                ? basePrice * (1 - current.discountValue / 100)
                : basePrice - current.discountValue
            : Infinity;

        if (candidateResultingPrice < currentResultingPrice) {
            bestByProductId.set(campaignProduct.productId, {
                campaignId: campaignProduct.campaign.id,
                campaignName: campaignProduct.campaign.name,
                discountType: campaignProduct.discountType,
                discountValue: Number(campaignProduct.discountValue),
            });
        }
    }

    return bestByProductId;
};

export const CampaignService = {
    createCampaign,
    getAdminCampaigns,
    getCampaignOrThrow,
    updateCampaign,
    deleteCampaign,
    getActiveDiscountsForProducts,
};
