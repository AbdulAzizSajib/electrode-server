import status from "http-status";
import { BannerStatus, Prisma } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { IBannerProductSummary, ICreateBannerPayload, IPublicBanner, IUpdateBannerPayload } from "./banner.interface";
import { checkBannerTypeContract } from "./banner.validation";

/**
 * The slim product summary a banner needs to render — deliberately not the full
 * product (design.md Decision 4). `images` is scoped to the primary one only.
 */
const bannerProductSelect = {
    id: true,
    name: true,
    slug: true,
    price: true,
    compareAtPrice: true,
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
              price: product.price,
              compareAtPrice: product.compareAtPrice,
              image: product.images[0]?.url ?? null,
          }
        : null;

    return {
        ...rest,
        product: productSummary,
        resolvedPrice: productSummary ? productSummary.price : rest.price,
        resolvedDiscountPrice: productSummary ? productSummary.compareAtPrice : rest.discountPrice,
        resolvedLink: productSummary ? `/products/${productSummary.slug}` : (rest.link ?? null),
    };
};

const createBanner = async (payload: ICreateBannerPayload) => {
    const { startsAt, endsAt, productId, ...rest } = payload;

    if (productId) {
        await assertProductExists(productId);
    }

    return prisma.banner.create({
        data: {
            ...rest,
            ...(productId ? { productId } : {}),
            startsAt: startsAt ? new Date(startsAt) : undefined,
            endsAt: endsAt ? new Date(endsAt) : undefined,
        },
    });
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

    const violations: string[] = [];
    checkBannerTypeContract(merged, (_path, message) => violations.push(message));

    if (violations.length > 0) {
        throw new AppError(status.BAD_REQUEST, violations.join("; "));
    }

    return prisma.banner.update({
        where: { id },
        data: {
            ...rest,
            ...(productId !== undefined ? { productId } : {}),
            startsAt: startsAt ? new Date(startsAt) : undefined,
            endsAt: endsAt ? new Date(endsAt) : undefined,
        },
    });
};

const deleteBanner = async (id: string) => {
    await getBannerOrThrow(id);

    return prisma.banner.delete({ where: { id } });
};

export const BannerService = {
    createBanner,
    getPublicBanners,
    getAdminBanners,
    getBannerOrThrow,
    updateBanner,
    deleteBanner,
};
