import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { generateUniqueSlug } from "../../utils/slug";
import { AuditLogService } from "../audit-log/audit-log.service";
import { ICreateCategoryPayload, IUpdateCategoryPayload } from "./category.interface";

const assertParentExists = async (parentId: string) => {
    const parent = await prisma.category.findUnique({
        where: { id: parentId },
        select: { id: true },
    });

    if (!parent) {
        throw new AppError(status.BAD_REQUEST, "Parent category not found");
    }
};

/**
 * Walks up from `parentId` toward the root; rejects if `id` (the category
 * being updated) appears anywhere in that chain, which would make the
 * hierarchy circular.
 */
const assertNoCycle = async (id: string, parentId: string) => {
    if (parentId === id) {
        throw new AppError(status.BAD_REQUEST, "A category cannot be its own parent");
    }

    let currentId: string | null = parentId;
    const visited = new Set<string>();

    while (currentId) {
        if (currentId === id) {
            throw new AppError(
                status.BAD_REQUEST,
                "This would create a circular category hierarchy",
            );
        }

        if (visited.has(currentId)) {
            break;
        }
        visited.add(currentId);

        const parent: { parentId: string | null } | null = await prisma.category.findUnique({
            where: { id: currentId },
            select: { parentId: true },
        });

        currentId = parent?.parentId ?? null;
    }
};

const createCategory = async (userId: string, payload: ICreateCategoryPayload) => {
    if (payload.parentId) {
        await assertParentExists(payload.parentId);
    }

    const slug = await generateUniqueSlug(payload.slug || payload.name, (candidate) =>
        prisma.category
            .findUnique({ where: { slug: candidate }, select: { id: true } })
            .then((existing) => Boolean(existing)),
    );

    const category = await prisma.category.create({
        data: { ...payload, slug },
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "Category", category.id, {
        newData: category,
    });

    return category;
};

/** Public: top-level (parentId: null) ACTIVE categories, with one level of ACTIVE children. */
const getPublicCategoryTree = async () => {
    return prisma.category.findMany({
        where: { parentId: null, status: true },
        include: {
            children: {
                where: { status: true },
                orderBy: { sortOrder: "asc" },
            },
        },
        orderBy: { sortOrder: "asc" },
    });
};

const getPublicCategoryBySlug = async (slug: string) => {
    const category = await prisma.category.findFirst({
        where: { slug, status: true },
        include: {
            parent: true,
            children: {
                where: { status: true },
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!category) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }

    return category;
};

const getAdminCategories = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.category, queryParams, {
        searchableFields: ["name", "slug"],
        filterableFields: ["status", "parentId"],
    });

    return queryBuilder
        .search()
        .filter()
        .sort()
        .paginate()
        .include({ parent: true })
        .execute();
};

/**
 * Admin: full hierarchy (any status, unlimited depth), nested via `children`.
 * Prisma can't `include` a recursive relation to arbitrary depth, so the
 * flat list is fetched once and assembled into a tree in memory.
 */
const getAdminCategoryTree = async () => {
    const all = await prisma.category.findMany({
        orderBy: { sortOrder: "asc" },
    });

    type CategoryNode = (typeof all)[number] & { children: CategoryNode[] };

    const byId = new Map<string, CategoryNode>(
        all.map((category) => [category.id, { ...category, children: [] }]),
    );
    const roots: CategoryNode[] = [];

    for (const node of byId.values()) {
        const parent = node.parentId ? byId.get(node.parentId) : undefined;
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }

    return roots;
};

const getAdminCategoryById = async (id: string) => {
    const category = await prisma.category.findUnique({
        where: { id },
        include: { parent: true, children: true },
    });

    if (!category) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }

    return category;
};

const updateCategory = async (userId: string, id: string, payload: IUpdateCategoryPayload) => {
    const existing = await prisma.category.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }

    if (payload.parentId) {
        await assertParentExists(payload.parentId);
        await assertNoCycle(id, payload.parentId);
    }

    let slug = existing.slug;
    if (payload.slug || (payload.name && payload.name !== existing.name)) {
        slug = await generateUniqueSlug(payload.slug || payload.name || existing.name, (candidate) =>
            prisma.category
                .findFirst({ where: { slug: candidate, id: { not: id } }, select: { id: true } })
                .then((found) => Boolean(found)),
        );
    }

    const updated = await prisma.category.update({
        where: { id },
        data: { ...payload, slug },
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Category", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

const deleteCategory = async (userId: string, id: string) => {
    const existing = await prisma.category.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }

    // Children fall back to root (parentId SetNull) and products lose their
    // primary category reference (categoryId SetNull) per the schema's
    // onDelete behavior — this delete does not cascade-destroy either.
    const deleted = await prisma.category.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "Category", id, { oldData: existing });

    return deleted;
};

export const CategoryService = {
    createCategory,
    getPublicCategoryTree,
    getPublicCategoryBySlug,
    getAdminCategories,
    getAdminCategoryTree,
    getAdminCategoryById,
    updateCategory,
    deleteCategory,
};
