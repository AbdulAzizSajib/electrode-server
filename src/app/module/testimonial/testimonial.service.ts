import status from "http-status";
import { AuditAction, TestimonialStatus } from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { revalidateStorefront } from "../../utils/revalidateStorefront";
import { AuditLogService } from "../audit-log/audit-log.service";
import { TESTIMONIALS_TAG } from "./testimonial.constant";
import { ICreateTestimonialPayload, IUpdateTestimonialPayload } from "./testimonial.interface";

/**
 * The merchant's own order, then newest first among equals. Matches how Banner
 * orders its placements, so the two content managers behave the same way when a
 * merchant leaves every `sortOrder` at 0.
 */
const DISPLAY_ORDER = [{ sortOrder: "asc" as const }, { createdAt: "desc" as const }];

const getTestimonialOrThrow = async (id: string) => {
    const testimonial = await prisma.testimonial.findUnique({ where: { id } });

    if (!testimonial) {
        throw new AppError(status.NOT_FOUND, "Testimonial not found");
    }

    return testimonial;
};

const createTestimonial = async (
    userId: string | undefined,
    payload: ICreateTestimonialPayload,
) => {
    const testimonial = await prisma.testimonial.create({ data: payload });

    await AuditLogService.record(userId, AuditAction.CREATE, "Testimonial", testimonial.id, {
        newData: testimonial,
    });

    revalidateStorefront(TESTIMONIALS_TAG);

    return testimonial;
};

const updateTestimonial = async (
    userId: string | undefined,
    id: string,
    payload: IUpdateTestimonialPayload,
) => {
    const existing = await getTestimonialOrThrow(id);

    const testimonial = await prisma.testimonial.update({ where: { id }, data: payload });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Testimonial", id, {
        oldData: existing,
        newData: testimonial,
    });

    revalidateStorefront(TESTIMONIALS_TAG);

    return testimonial;
};

const deleteTestimonial = async (userId: string | undefined, id: string) => {
    const existing = await getTestimonialOrThrow(id);

    const testimonial = await prisma.testimonial.delete({ where: { id } });

    await AuditLogService.record(userId, AuditAction.DELETE, "Testimonial", id, {
        oldData: existing,
    });

    revalidateStorefront(TESTIMONIALS_TAG);

    return testimonial;
};

/**
 * Admin: any status, in display order.
 *
 * Ordered the way the storefront orders them rather than newest-first, because
 * the list doubles as the reordering surface — a merchant deciding which quote
 * leads has to be looking at the sequence the site will render.
 */
const getAdminTestimonials = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(
        prisma.testimonial,
        /*
         * Opens in the merchant's own order rather than QueryBuilder's
         * newest-first default: this list doubles as the reordering surface, and
         * a merchant deciding which quote leads has to be looking at the
         * sequence the site will render. Still overridable with ?sortBy=.
         *
         * Sorted in the DATABASE, not after pagination — sorting a page in
         * memory reorders that page's ten rows while leaving which ten they are
         * decided by a different order, which is wrong at every page boundary.
         */
        {
            ...queryParams,
            sortBy: queryParams.sortBy || "sortOrder",
            sortOrder: queryParams.sortOrder || "asc",
        },
        {
            searchableFields: ["quote", "authorName", "authorRole"],
            filterableFields: ["status"],
        },
    );

    return queryBuilder.search().filter().sort().paginate().execute();
};

/**
 * Public: PUBLISHED only, in the merchant's order.
 *
 * `take` bounds what the homepage section renders. Unbounded when omitted, for
 * a future page that lists them all.
 */
const getPublishedTestimonials = async (take?: number) => {
    return prisma.testimonial.findMany({
        where: { status: TestimonialStatus.PUBLISHED },
        orderBy: DISPLAY_ORDER,
        ...(take !== undefined ? { take } : {}),
    });
};

/** How many are published, so the admin can say which fall beyond the section. */
const countPublishedTestimonials = async () => {
    return prisma.testimonial.count({ where: { status: TestimonialStatus.PUBLISHED } });
};

export const TestimonialService = {
    createTestimonial,
    updateTestimonial,
    deleteTestimonial,
    getAdminTestimonials,
    getTestimonialOrThrow,
    getPublishedTestimonials,
    countPublishedTestimonials,
};
