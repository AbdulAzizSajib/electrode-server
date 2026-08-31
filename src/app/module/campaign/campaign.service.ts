import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { CampaignPlacement, CampaignStatus } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { IActiveCampaignDiscount, ICreateCampaignPayload, IUpdateCampaignPayload } from "./campaign.interface";

const CAMPAIGN_INCLUDE = {
    products: { include: { product: { select: { id: true, name: true, slug: true } } } },
};

/**
 * What makes a campaign live right now: `ACTIVE`, and the present moment inside
 * its `startsAt`/`endsAt` window. A null bound means "unbounded on that side".
 *
 * Deliberately one definition shared by every reader. The public placement
 * lookup and the automatic product-discount resolution MUST agree: if the
 * lookup were laxer, a campaign could be served into a homepage slot — with a
 * countdown running — while its discounts were not being applied, so the
 * shopper would see a deal on undiscounted prices (design.md Decision 4).
 */
const activeCampaignWhere = (now: Date) => ({
    status: CampaignStatus.ACTIVE,
    AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
});

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
            campaign: activeCampaignWhere(now),
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

/**
 * The campaign currently occupying a storefront slot, or null when none does.
 *
 * Returns the campaign row plus the ids of the products it discounts — not the
 * priced products. Pricing is applied by `ProductService.getActiveCampaign`,
 * which owns `attachCampaignPricing`; putting it here would make this module
 * import product.service, which already imports this one.
 *
 * At most one campaign is served per slot. `placement` is deliberately not
 * unique in the schema — a successor campaign must be schedulable while the
 * current one still runs — so when two eligible campaigns claim the same slot
 * the most recently started wins (design.md Decision 4). `startsAt: null` means
 * "running since forever", so it sorts last behind any explicit start; `nulls:
 * "last"` states that rather than leaving it to the database's default.
 */
const getActiveCampaignByPlacement = async (placement: CampaignPlacement) => {
    return prisma.campaign.findFirst({
        where: {
            ...activeCampaignWhere(new Date()),
            placement,
        },
        orderBy: { startsAt: { sort: "desc", nulls: "last" } },
        include: { products: { select: { productId: true } } },
    });
};

export const CampaignService = {
    createCampaign,
    getAdminCampaigns,
    getCampaignOrThrow,
    getActiveCampaignByPlacement,
    updateCampaign,
    deleteCampaign,
    getActiveDiscountsForProducts,
};
