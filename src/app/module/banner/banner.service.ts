import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { BannerStatus } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { ICreateBannerPayload, IUpdateBannerPayload } from "./banner.interface";

const createBanner = async (payload: ICreateBannerPayload) => {
    const { startsAt, endsAt, ...rest } = payload;

    return prisma.banner.create({
        data: {
            ...rest,
            startsAt: startsAt ? new Date(startsAt) : undefined,
            endsAt: endsAt ? new Date(endsAt) : undefined,
        },
    });
};

/** Public: ACTIVE and currently within its startsAt/endsAt window only — per `api/marketing` spec. */
const getPublicBanners = async () => {
    const now = new Date();

    return prisma.banner.findMany({
        where: {
            status: BannerStatus.ACTIVE,
            AND: [
                { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            ],
        },
        orderBy: { sortOrder: "asc" },
    });
};

const getAdminBanners = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.banner, queryParams, {
        searchableFields: ["title", "subtitle"],
        filterableFields: ["status"],
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
    await getBannerOrThrow(id);

    const { startsAt, endsAt, ...rest } = payload;

    return prisma.banner.update({
        where: { id },
        data: {
            ...rest,
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
