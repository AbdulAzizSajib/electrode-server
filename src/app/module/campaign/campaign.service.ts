import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { CampaignPlacement, CampaignStatus } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { CAMPAIGNS_TAG, PRODUCTS_TAG, revalidateStorefront } from "../../utils/revalidateStorefront";
import { IActiveCampaignDiscount, ICreateCampaignPayload, IUpdateCampaignPayload } from "./campaign.interface";

/**
 * Drops the storefront's cached campaign reads, and its product reads with them.
 *
 * TWO tags, deliberately. `campaigns` covers the Deal of the Week section; but a
 * campaign write also changes `campaignPrice` on every product it discounts, and
 * those are cached under `products`. Firing only the first removes the countdown
 * while leaving the discounted price on the product cards — an inconsistency
 * worse than the staleness it fixes.
 *
 * This is an explicit cross-resource fire, not an inferred one: the revalidate
 * route knows nothing about which resource embeds which, so the dependency is
 * stated here where it is true (design.md Decision 6).
 */
const revalidateCampaigns = () => {
    revalidateStorefront(CAMPAIGNS_TAG);
    revalidateStorefront(PRODUCTS_TAG);
};

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

    const campaign = await prisma.campaign.create({
        data: {
            ...rest,
            startsAt: startsAt ? new Date(startsAt) : undefined,
            endsAt: endsAt ? new Date(endsAt) : undefined,
            ...(products && products.length > 0 ? { products: { create: products } } : {}),
        },
        include: CAMPAIGN_INCLUDE,
    });

    revalidateCampaigns();

    return campaign;
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

    const campaign = await prisma.$transaction(async (tx) => {
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

    /*
     * AFTER the transaction resolves, never inside it. Firing from within means
     * a rollback still invalidates — and worse, the storefront can re-fetch and
     * re-cache the pre-transaction state before the commit lands, pinning the
     * old campaign in cache for a full window.
     */
    revalidateCampaigns();

    return campaign;
};

const deleteCampaign = async (id: string) => {
    await getCampaignOrThrow(id);

    const campaign = await prisma.campaign.delete({ where: { id } });

    /*
     * The path that prompted this whole change. `DealOfWeek` hides itself when a
     * campaign's deadline PASSES, which a deleted campaign's never does — so
     * without this the section kept rendering its countdown until the cache
     * expired on its own.
     */
    revalidateCampaigns();

    return campaign;
};

/**
 * What `basePrice` becomes under `discount`. The ONE definition of that
 * arithmetic — display and checkout both call it, and must.
 *
 * Split out when checkout was found charging `offerPrice` while the storefront
 * advertised the discounted figure: a shopper saw 800 on the card and was
 * billed 1000. Two implementations of "what does this cost" is how that
 * happens, so there is now one. If this rounds or clamps differently for one
 * caller than the other, the bug is back.
 *
 * Floored at zero: a FIXED discount larger than the price must not produce a
 * negative line that silently pays the shopper to take the goods.
 */
export const applyCampaignDiscount = (
    basePrice: number,
    discount: Pick<IActiveCampaignDiscount, "discountType" | "discountValue">,
) =>
    discount.discountType === "PERCENTAGE"
        ? Math.max(0, basePrice * (1 - discount.discountValue / 100))
        : Math.max(0, basePrice - discount.discountValue);

/**
 * Resolves each product's best (largest) currently-active `CampaignProduct`
 * discount, for `api/catalog`'s public product read endpoints to reflect
 * automatically — per `api/marketing` spec, no separate customer-facing
 * endpoint or customer action is needed. "Best" (rather than stacking) is
 * this implementation's choice for when more than one active campaign
 * targets the same product — the spec doesn't define stacking behavior.
 *
 * Also the resolver CHECKOUT uses, via `getActiveDiscountsForLines` below —
 * the same window, the same best-of rule, so an order is priced under exactly
 * the campaign the shopper was shown.
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

        const candidateResultingPrice = applyCampaignDiscount(basePrice, {
            discountType: campaignProduct.discountType,
            discountValue: Number(campaignProduct.discountValue),
        });

        const current = bestByProductId.get(campaignProduct.productId);
        const currentResultingPrice = current
            ? applyCampaignDiscount(basePrice, current)
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
 * What each checkout line's unit actually costs once any active campaign is
 * applied — the checkout counterpart to `attachCampaignPricing`.
 *
 * Keyed by `productId:variantId` rather than by product, because a campaign
 * targets a PRODUCT while a line is priced from its VARIANT. The discount is
 * applied to the price that line would otherwise be charged (the variant's own
 * `offerPrice`, falling back to the product's), so every variant of a
 * campaigned product gets the same proportional cut rather than one computed
 * off a price the shopper is not paying. A 20% campaign takes 20% off the
 * 256GB model's own price, not 20% of the 128GB's.
 *
 * Note the consequence, which is real and accepted: the storefront currently
 * renders ONE product-level `campaignPrice` regardless of the selected
 * variant, so on a product whose variants are priced differently the cart can
 * charge a different figure than the product card showed. The charge is the
 * defensible one — it is the selected variant's price, discounted — but
 * closing that gap means returning per-variant campaign prices from the
 * product endpoints, which is its own change.
 *
 * Returns an empty map when nothing is campaigned, so callers stay on their
 * existing `offerPrice` path untouched.
 */
const getActiveDiscountsForLines = async (
    lines: { productId: string; variantId: string | null; unitPrice: number }[],
): Promise<Map<string, number>> => {
    if (lines.length === 0) {
        return new Map();
    }

    /*
     * One lookup for the whole basket.
     *
     * `getActiveDiscountsForProducts` needs a price per PRODUCT only to rank
     * competing campaigns against each other (is 10% better than ৳100 off?).
     * Two variants of one product can carry different prices, so the lowest is
     * used deliberately rather than whichever line happened to be last: on the
     * cheapest variant a percentage discount is at its least valuable, so
     * ranking there never overstates it and never picks a campaign that turns
     * out worse for the line actually being charged.
     *
     * The chosen discount is then applied to each line's OWN price below, so
     * this figure never reaches the shopper's total.
     */
    const priceByProductId = new Map<string, number>();
    for (const line of lines) {
        const current = priceByProductId.get(line.productId);
        if (current === undefined || line.unitPrice < current) {
            priceByProductId.set(line.productId, line.unitPrice);
        }
    }
    const discounts = await getActiveDiscountsForProducts(
        [...new Set(lines.map((line) => line.productId))],
        priceByProductId,
    );

    const priceByLineKey = new Map<string, number>();

    for (const line of lines) {
        const discount = discounts.get(line.productId);
        if (!discount) {
            continue;
        }

        priceByLineKey.set(
            `${line.productId}:${line.variantId ?? ""}`,
            applyCampaignDiscount(line.unitPrice, discount),
        );
    }

    return priceByLineKey;
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
    getActiveDiscountsForLines,
    applyCampaignDiscount,
};
