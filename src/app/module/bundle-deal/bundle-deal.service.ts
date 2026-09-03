import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
    ICreateBundleDealPayload,
    IUpdateBundleDealPayload,
} from "./bundle-deal.interface";

const ensureNameIsFree = async (name: string, excludeId?: string) => {
    const clash = await prisma.bundleDeal.findFirst({
        where: {
            name: { equals: name.trim(), mode: "insensitive" },
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { name: true },
    });

    if (clash) {
        throw new AppError(status.CONFLICT, `A bundle deal named "${clash.name}" already exists`);
    }
};

const createBundleDeal = async (userId: string, payload: ICreateBundleDealPayload) => {
    await ensureNameIsFree(payload.name);

    const deal = await prisma.bundleDeal.create({
        data: { ...payload, name: payload.name.trim() },
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "BundleDeal", deal.id, {
        newData: deal,
    });

    return deal;
};

const updateBundleDeal = async (userId: string, id: string, payload: IUpdateBundleDealPayload) => {
    const existing = await prisma.bundleDeal.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Bundle deal not found");
    }

    if (payload.name) {
        await ensureNameIsFree(payload.name, id);
    }

    const updated = await prisma.bundleDeal.update({
        where: { id },
        data: { ...payload, ...(payload.name ? { name: payload.name.trim() } : {}) },
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "BundleDeal", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

/**
 * Deletes a bundle deal. Products carrying it are left sold without an offer —
 * the foreign key is SetNull, so nothing is orphaned and nothing is blocked.
 *
 * The merchant is told how many products lose the offer, since that is a
 * commercial consequence they should not discover from a customer.
 */
const deleteBundleDeal = async (userId: string, id: string, options: { force?: boolean } = {}) => {
    const existing = await prisma.bundleDeal.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Bundle deal not found");
    }

    const inUse = await prisma.product.count({ where: { bundleDealId: id } });

    if (inUse > 0 && !options.force) {
        throw new AppError(
            status.CONFLICT,
            `${inUse} product${inUse === 1 ? " carries" : "s carry"} this offer. Confirm to delete it and sell ${inUse === 1 ? "it" : "them"} without one.`,
        );
    }

    await prisma.bundleDeal.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "BundleDeal", id, {
        oldData: existing,
    });

    return { bundleDeal: existing, affectedProducts: inUse };
};

const getBundleDeals = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.bundleDeal, queryParams, {
        searchableFields: ["name"],
        filterableFields: [],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

const getBundleDealById = async (id: string) => {
    const deal = await prisma.bundleDeal.findUnique({ where: { id } });

    if (!deal) {
        throw new AppError(status.NOT_FOUND, "Bundle deal not found");
    }

    return deal;
};

/** Every deal, for the product form's picker. Unpaginated. */
const getAllBundleDeals = async () => prisma.bundleDeal.findMany({ orderBy: { name: "asc" } });

export const BundleDealService = {
    createBundleDeal,
    updateBundleDeal,
    deleteBundleDeal,
    getBundleDeals,
    getBundleDealById,
    getAllBundleDeals,
};
