import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { generateUniqueSlug } from "../../utils/slug";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
    ICreateCollectionPayload,
    IUpdateCollectionPayload,
} from "./collection.interface";

const createCollection = async (userId: string, payload: ICreateCollectionPayload) => {
    const slug = await generateUniqueSlug(payload.slug || payload.name, (candidate) =>
        prisma.collection
            .findUnique({ where: { slug: candidate }, select: { id: true } })
            .then((existing) => Boolean(existing)),
    );

    const collection = await prisma.collection.create({
        data: { name: payload.name.trim(), slug, isVisible: payload.isVisible ?? true },
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "Collection", collection.id, {
        newData: collection,
    });

    return collection;
};

const updateCollection = async (userId: string, id: string, payload: IUpdateCollectionPayload) => {
    const existing = await prisma.collection.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Collection not found");
    }

    let slug = existing.slug;
    if (payload.slug || (payload.name && payload.name !== existing.name)) {
        slug = await generateUniqueSlug(payload.slug || payload.name || existing.name, (candidate) =>
            prisma.collection
                .findFirst({ where: { slug: candidate, id: { not: id } }, select: { id: true } })
                .then((found) => Boolean(found)),
        );
    }

    const updated = await prisma.collection.update({
        where: { id },
        data: {
            ...(payload.name ? { name: payload.name.trim() } : {}),
            ...(payload.isVisible !== undefined ? { isVisible: payload.isVisible } : {}),
            slug,
        },
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Collection", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

/**
 * Deletes a collection. Its products are untouched — only the memberships go,
 * which the cascade on ProductCollection handles.
 *
 * No reassignment prompt, unlike tax and shipping rules: a product without a
 * collection is perfectly sellable, so there is nothing to rescue.
 */
const deleteCollection = async (userId: string, id: string) => {
    const existing = await prisma.collection.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Collection not found");
    }

    const memberships = await prisma.productCollection.count({ where: { collectionId: id } });

    await prisma.collection.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "Collection", id, {
        oldData: existing,
    });

    return { collection: existing, removedMemberships: memberships };
};

const getCollections = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.collection, queryParams, {
        searchableFields: ["name", "slug"],
        filterableFields: ["isVisible"],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

const getCollectionById = async (id: string) => {
    const collection = await prisma.collection.findUnique({ where: { id } });

    if (!collection) {
        throw new AppError(status.NOT_FOUND, "Collection not found");
    }

    return collection;
};

/** Every collection, for the product form's checkbox list. Unpaginated. */
const getAllCollections = async () => prisma.collection.findMany({ orderBy: { name: "asc" } });

export const CollectionService = {
    createCollection,
    updateCollection,
    deleteCollection,
    getCollections,
    getCollectionById,
    getAllCollections,
};
