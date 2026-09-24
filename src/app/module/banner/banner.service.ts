import status from "http-status";
import { BannerStatus, Prisma } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { BANNERS_TAG, STORE_SETTINGS_TAG, revalidateStorefront } from "../../utils/revalidateStorefront";
import { IBannerProductSummary, ICreateBannerPayload, IPublicBanner, IUpdateBannerPayload } from "./banner.interface";
import { checkBannerTypeContract, staleDynamicFields } from "./banner.validation";
import { PROMO_GROUP_PLACEMENT } from "../promo-banner-group/promo-banner-group.constant";

/**
 * The slim product summary a banner needs to render — deliberately not the full
 * product (design.md Decision 4). `images` is scoped to the primary one only.
 */
const bannerProductSelect = {
    id: true,
    name: true,
    slug: true,
    offerPrice: true,
    sellingPrice: true,
    images: {
        where: { isPrimary: true },
        take: 1,
        select: { url: true },
    },
} satisfies Prisma.ProductSelect;

type BannerWithProduct = Prisma.BannerGetPayload<{
    include: { product: { select: typeof bannerProductSelect } };
}>;

/** 404 rather than letting a bad reference surface as a raw Prisma foreign-key error. */
const assertProductExists = async (productId: string) => {
    const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
    });

    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }
};

/**
 * Guards a banner's promo-group membership.
 *
 * Two rules, both of which must be checked against the RESOLVED placement —
 * that is, the one the banner will have after this write, not the one in the
 * request. A PATCH that sets a group without mentioning `placement` has to be
 * judged against the stored placement, and a PATCH that changes `placement`
 * away from MID has to be judged against the new one. Passing the merged value
 * in is what makes both cases the same call.
 *
 *  1. ONLY A `MID` BANNER MAY BELONG TO A GROUP. The hero placements are owned
 *     by the Home Slider manager with its own per-layout capacity rules; a
 *     group claiming one would mean the same record edited from two surfaces
 *     under two different sets of rules.
 *  2. The group must exist — a 404 rather than the raw Prisma foreign-key error
 *     a dangling id would otherwise produce.
 *
 * `null` is not a violation of either: it is how a merchant takes a tile out of
 * a strip without deleting the artwork.
 *
 * See openspec/changes/add-promo-banner-groups, design.md Decision 2.
 */
const assertPromoGroupAssignable = async (
    promoBannerGroupId: string | null | undefined,
    resolvedPlacement: ICreateBannerPayload["placement"],
) => {
    if (promoBannerGroupId === undefined || promoBannerGroupId === null) return;

    if (resolvedPlacement !== PROMO_GROUP_PLACEMENT) {
        throw new AppError(
            status.BAD_REQUEST,
            `Only a ${PROMO_GROUP_PLACEMENT}-placement banner can belong to a promo banner group`,
        );
    }

    const group = await prisma.promoBannerGroup.findUnique({
        where: { id: promoBannerGroupId },
        select: { id: true },
    });

    if (!group) {
        throw new AppError(status.NOT_FOUND, "Promo banner group not found");
    }
};

/**
 * Resolves what the storefront actually renders (design.md Decisions 3, 4, 5):
 * a linked product's live price and slug win over the banner's stored columns,
 * so a product-linked banner can never disagree with the product's own page.
 * A deleted product degrades to the banner's own values instead of failing.
 */
const toPublicBanner = (banner: BannerWithProduct): IPublicBanner => {
    const { product, ...rest } = banner;

    const productSummary: IBannerProductSummary | null = product
        ? {
              id: product.id,
              name: product.name,
              slug: product.slug,
              offerPrice: product.offerPrice,
              sellingPrice: product.sellingPrice,
              image: product.images[0]?.url ?? null,
          }
        : null;

    return {
        ...rest,
        product: productSummary,
        /*
         * The banner's own `price`/`discountPrice` columns keep their names —
         * they are a banner's authored fallback, not one of the product's three
         * prices, and renaming them is out of scope. Only the source fields on
         * the linked product changed: what a shopper pays is `offerPrice`, and
         * the struck-through figure beside it is `sellingPrice`.
         */
        resolvedPrice: productSummary ? productSummary.offerPrice : rest.price,
        resolvedDiscountPrice: productSummary ? productSummary.sellingPrice : rest.discountPrice,
        resolvedLink: productSummary ? `/products/${productSummary.slug}` : (rest.link ?? null),
    };
};

const createBanner = async (payload: ICreateBannerPayload) => {
    const { startsAt, endsAt, productId, ...rest } = payload;

    if (productId) {
        await assertProductExists(productId);
    }

    // On create the request's own placement IS the resolved one — there is no
    // stored row to merge against.
    await assertPromoGroupAssignable(rest.promoBannerGroupId, rest.placement);

    const banner = await prisma.banner.create({
        data: {
            ...rest,
            ...(productId ? { productId } : {}),
            startsAt: startsAt ? new Date(startsAt) : undefined,
            endsAt: endsAt ? new Date(endsAt) : undefined,
        },
    });

    revalidateStorefront(BANNERS_TAG);

    // A banner created straight into a group changes what that strip renders,
    // and group membership is read alongside the settings payload — so the same
    // two-tag rule the group service follows applies here. See
    // promo-banner-group.service.ts for why one tag is not enough.
    if (banner.promoBannerGroupId) {
        revalidateStorefront(STORE_SETTINGS_TAG);
    }

    return banner;
};

/** Public: ACTIVE and currently within its startsAt/endsAt window only — per `api/marketing` spec. */
const getPublicBanners = async (placement?: ICreateBannerPayload["placement"]) => {
    const now = new Date();

    const banners = await prisma.banner.findMany({
        where: {
            status: BannerStatus.ACTIVE,
            ...(placement ? { placement } : {}),
            AND: [
                { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            ],
        },
        orderBy: { sortOrder: "asc" },
        include: { product: { select: bannerProductSelect } },
    });

    return banners.map(toPublicBanner);
};

const getAdminBanners = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.banner, queryParams, {
        searchableFields: ["title", "subtitle"],
        filterableFields: ["status", "type", "placement"],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

const getBannerOrThrow = async (id: string) => {
    const banner = await prisma.banner.findUnique({ where: { id } });

    if (!banner) {
        throw new AppError(status.NOT_FOUND, "Banner not found");
    }

    return banner;
};

const updateBanner = async (id: string, payload: IUpdateBannerPayload) => {
    const existing = await getBannerOrThrow(id);

    const { startsAt, endsAt, productId, ...rest } = payload;

    if (productId) {
        await assertProductExists(productId);
    }

    /**
     * A PATCH body alone can't be judged against the type contract — whether
     * clearing `title` is legal depends on the stored `type`. So the contract
     * (same helper the create schema uses) runs against the merged result.
     */
    const merged = { ...existing, ...rest, ...(productId !== undefined ? { productId } : {}) };

    // Stored DYNAMIC-only content the request never mentioned is cleared, not
    // reported — see `staleDynamicFields` for why judging it locked rows out.
    const clears = staleDynamicFields(merged, rest);
    Object.assign(merged, clears);

    const violations: string[] = [];
    checkBannerTypeContract(merged, (_path, message) => violations.push(message));

    if (violations.length > 0) {
        throw new AppError(status.BAD_REQUEST, violations.join("; "));
    }

    /*
     * Judged against the MERGED placement, so both directions are covered: a
     * request that sets a group without mentioning placement is checked against
     * the stored one, and a request that moves the banner off MID is checked
     * against the new one.
     *
     * That second case matters — a banner already in a group whose placement is
     * being changed to HERO_SIDE would otherwise keep a group membership its
     * new placement is not allowed to have. `rest.promoBannerGroupId ?? existing`
     * is what makes the stored membership visible to the check when the request
     * is silent about it.
     */
    await assertPromoGroupAssignable(
        rest.promoBannerGroupId !== undefined
            ? rest.promoBannerGroupId
            : existing.promoBannerGroupId,
        merged.placement,
    );

    const banner = await prisma.banner.update({
        where: { id },
        data: {
            ...rest,
            ...clears,
            ...(productId !== undefined ? { productId } : {}),
            startsAt: startsAt ? new Date(startsAt) : undefined,
            endsAt: endsAt ? new Date(endsAt) : undefined,
        },
    });

    revalidateStorefront(BANNERS_TAG);

    /*
     * Fires when the banner was in a group BEFORE, or is in one AFTER — not
     * only when the request mentions the field.
     *
     * Moving a tile out of a strip changes that strip as surely as moving one
     * in does, and the two states are different rows. Checking only the new
     * value would leave the source strip stale after every reassignment, which
     * is the exact half-invalidated state that reads as "my save did nothing".
     */
    if (existing.promoBannerGroupId || banner.promoBannerGroupId) {
        revalidateStorefront(STORE_SETTINGS_TAG);
    }

    return banner;
};

const deleteBanner = async (id: string) => {
    const existing = await getBannerOrThrow(id);

    const banner = await prisma.banner.delete({ where: { id } });

    revalidateStorefront(BANNERS_TAG);

    // Deleting a tile shortens the strip it belonged to.
    if (existing.promoBannerGroupId) {
        revalidateStorefront(STORE_SETTINGS_TAG);
    }

    return banner;
};

export const BannerService = {
    createBanner,
    getPublicBanners,
    getAdminBanners,
    getBannerOrThrow,
    updateBanner,
    deleteBanner,
};
