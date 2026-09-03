import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, Prisma } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";

/** Enough to choose from without becoming a list to read. */
const SUGGESTION_LIMIT = 10;

/**
 * Finds a tag by name or creates it, comparing case-insensitively.
 *
 * The unique index is exact, so "Wireless" and "wireless" would otherwise both
 * exist and a merchant would be offered two suggestions that look identical —
 * exactly what suggestion is meant to prevent. The first spelling used wins.
 */
const findOrCreateTag = async (tx: Prisma.TransactionClient, rawName: string) => {
    const name = rawName.trim();

    if (!name) {
        throw new AppError(status.BAD_REQUEST, "A tag cannot be blank");
    }

    const existing = await tx.tag.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true },
    });

    if (existing) return existing.id;

    const created = await tx.tag.create({ data: { name }, select: { id: true } });
    return created.id;
};

/**
 * Replaces a product's tags with exactly the names given.
 *
 * Replace rather than merge, matching how variants, images and attributes are
 * synced: the payload is the intended set, so a tag the merchant removed is
 * absent from it. Duplicates within the payload collapse, since the join's
 * composite key makes adding the same tag twice a no-op.
 */
const syncProductTags = async (
    tx: Prisma.TransactionClient,
    productId: string,
    names: string[],
) => {
    await tx.productTag.deleteMany({ where: { productId } });

    const seen = new Set<string>();

    for (const rawName of names) {
        const key = rawName.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);

        const tagId = await findOrCreateTag(tx, rawName);
        await tx.productTag.create({ data: { productId, tagId } });
    }
};

/**
 * Tags whose name contains `term`, for the admin's autocomplete.
 *
 * The whole point of storing tags as rows: a merchant reuses "wireless" instead
 * of creating "Wireless" beside it.
 */
const searchTags = async (term: string) => {
    const trimmed = term.trim();

    if (!trimmed) return [];

    return prisma.tag.findMany({
        where: { name: { contains: trimmed, mode: "insensitive" } },
        orderBy: { name: "asc" },
        take: SUGGESTION_LIMIT,
    });
};

const getTags = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.tag, queryParams, {
        searchableFields: ["name"],
        filterableFields: [],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

/**
 * Deletes a tag everywhere. Products keep everything else about them; they
 * simply lose the keyword, which is why this needs no confirmation.
 */
const deleteTag = async (userId: string, id: string) => {
    const existing = await prisma.tag.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Tag not found");
    }

    const taggedProducts = await prisma.productTag.count({ where: { tagId: id } });

    await prisma.tag.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "Tag", id, { oldData: existing });

    return { tag: existing, untaggedProducts: taggedProducts };
};

export const TagService = {
    syncProductTags,
    searchTags,
    getTags,
    deleteTag,
};
