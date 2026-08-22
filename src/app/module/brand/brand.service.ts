import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { generateUniqueSlug } from "../../utils/slug";
import { AuditLogService } from "../audit-log/audit-log.service";
import { ICreateBrandPayload, IUpdateBrandPayload } from "./brand.interface";

const createBrand = async (userId: string, payload: ICreateBrandPayload) => {
    const slug = await generateUniqueSlug(payload.slug || payload.name, (candidate) =>
        prisma.brand
            .findUnique({ where: { slug: candidate }, select: { id: true } })
            .then((existing) => Boolean(existing)),
    );

    const brand = await prisma.brand.create({ data: { ...payload, slug } });

    await AuditLogService.record(userId, AuditAction.CREATE, "Brand", brand.id, { newData: brand });

    return brand;
};

const getPublicBrands = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.brand, queryParams, {
        searchableFields: ["name"],
        filterableFields: [],
    });

    return queryBuilder.search().sort().paginate().where({ status: true }).execute();
};

const getPublicBrandBySlug = async (slug: string) => {
    const brand = await prisma.brand.findFirst({ where: { slug, status: true } });

    if (!brand) {
        throw new AppError(status.NOT_FOUND, "Brand not found");
    }

    return brand;
};

const getAdminBrands = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.brand, queryParams, {
        searchableFields: ["name", "slug"],
        filterableFields: ["status"],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

const getAdminBrandById = async (id: string) => {
    const brand = await prisma.brand.findUnique({ where: { id } });

    if (!brand) {
        throw new AppError(status.NOT_FOUND, "Brand not found");
    }

    return brand;
};

const updateBrand = async (userId: string, id: string, payload: IUpdateBrandPayload) => {
    const existing = await prisma.brand.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Brand not found");
    }

    let slug = existing.slug;
    if (payload.slug || (payload.name && payload.name !== existing.name)) {
        slug = await generateUniqueSlug(payload.slug || payload.name || existing.name, (candidate) =>
            prisma.brand
                .findFirst({ where: { slug: candidate, id: { not: id } }, select: { id: true } })
                .then((found) => Boolean(found)),
        );
    }

    const updated = await prisma.brand.update({ where: { id }, data: { ...payload, slug } });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Brand", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

const deleteBrand = async (userId: string, id: string) => {
    const existing = await prisma.brand.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Brand not found");
    }

    // Products lose their brand reference (brandId SetNull per schema) — not cascade-deleted.
    const deleted = await prisma.brand.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "Brand", id, { oldData: existing });

    return deleted;
};

export const BrandService = {
    createBrand,
    getPublicBrands,
    getPublicBrandBySlug,
    getAdminBrands,
    getAdminBrandById,
    updateBrand,
    deleteBrand,
};
