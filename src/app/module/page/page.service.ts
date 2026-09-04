import status from "http-status";
import { AuditAction, PageStatus } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { isReservedSlug, slugifyTitle } from "./page.constant";
import { ICreatePagePayload, IPageSummary, IUpdatePagePayload } from "./page.interface";

/**
 * Resolves the slug a write should store.
 *
 * An explicit slug wins. Otherwise it is derived from the title, and that
 * derived value is re-checked against the reserved list and the format rule —
 * the zod schema only validates a slug the client actually sent, so a title of
 * "Cart" or "!!!" would otherwise slip through unvalidated.
 */
const resolveSlug = (explicit: string | undefined, title: string | undefined): string => {
    if (explicit) return explicit;

    const derived = slugifyTitle(title ?? "");

    if (!derived) {
        throw new AppError(
            status.BAD_REQUEST,
            "Could not derive a slug from this title — enter one manually",
        );
    }

    if (isReservedSlug(derived)) {
        throw new AppError(
            status.CONFLICT,
            `"${derived}" is reserved by the storefront — enter a different slug`,
        );
    }

    return derived;
};

/**
 * Checked before the write rather than relying on Prisma's unique constraint,
 * so the merchant gets "Refund Policy already uses /refund-policy" instead of a
 * raw P2002. `excludeId` lets an update keep its own slug.
 */
const assertSlugAvailable = async (slug: string, excludeId?: string) => {
    const clash = await prisma.page.findUnique({
        where: { slug },
        select: { id: true, title: true },
    });

    if (clash && clash.id !== excludeId) {
        throw new AppError(
            status.CONFLICT,
            `The slug "${slug}" is already used by the page "${clash.title}"`,
        );
    }
};

const getPageOrThrow = async (id: string) => {
    const page = await prisma.page.findUnique({ where: { id } });

    if (!page) {
        throw new AppError(status.NOT_FOUND, "Page not found");
    }

    return page;
};

const createPage = async (userId: string | undefined, payload: ICreatePagePayload) => {
    const slug = resolveSlug(payload.slug, payload.title);

    await assertSlugAvailable(slug);

    const page = await prisma.page.create({ data: { ...payload, slug } });

    await AuditLogService.record(userId, AuditAction.CREATE, "Page", page.id, { newData: page });

    return page;
};

const updatePage = async (
    userId: string | undefined,
    id: string,
    payload: IUpdatePagePayload,
) => {
    const existing = await getPageOrThrow(id);

    // Only re-resolve when the client actually touched the slug. A PATCH that
    // just flips `status` must not silently re-derive the slug from the title
    // and move a live page's URL out from under its inbound links.
    const slug = payload.slug !== undefined ? resolveSlug(payload.slug, existing.title) : undefined;

    if (slug && slug !== existing.slug) {
        await assertSlugAvailable(slug, id);
    }

    const page = await prisma.page.update({
        where: { id },
        data: { ...payload, ...(slug ? { slug } : {}) },
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Page", id, {
        oldData: existing,
        newData: page,
    });

    return page;
};

const deletePage = async (userId: string | undefined, id: string) => {
    const existing = await getPageOrThrow(id);

    const page = await prisma.page.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "Page", id, { oldData: existing });

    return page;
};

/** Admin: any status, searchable, paginated. */
const getAdminPages = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.page, queryParams, {
        searchableFields: ["title", "slug"],
        filterableFields: ["status"],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

/**
 * Public: PUBLISHED only. A DRAFT is indistinguishable from a page that does
 * not exist — the caller gets null either way and the storefront 404s, so a
 * draft's title is never disclosed by the shape of the response.
 */
const getPublishedPageBySlug = async (slug: string) => {
    return prisma.page.findFirst({
        where: { slug, status: PageStatus.PUBLISHED },
    });
};

/** Public: the list the admin's link pickers and the footer editor offer as targets. */
const getPublishedPageSummaries = async (): Promise<IPageSummary[]> => {
    return prisma.page.findMany({
        where: { status: PageStatus.PUBLISHED },
        select: { id: true, title: true, slug: true },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    });
};

export const PageService = {
    createPage,
    updatePage,
    deletePage,
    getAdminPages,
    getPageOrThrow,
    getPublishedPageBySlug,
    getPublishedPageSummaries,
};
