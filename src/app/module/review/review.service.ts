import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import {
    AuditAction,
    NotificationType,
    OrderStatus,
    Prisma,
    ReviewStatus,
} from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { CustomerService } from "../customer/customer.service";
import { NotificationService } from "../notification/notification.service";
import {
    IAdminReplyPayload,
    ICreateReviewPayload,
    IUpdateMyReviewPayload,
    IUpdateReviewStatusPayload,
} from "./review.interface";

/** Order states that count as "the purchase actually happened" for the verified-purchaser check. */
const QUALIFYING_ORDER_STATUSES: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.COMPLETED];

const REVIEW_INCLUDE = {
    customer: { select: { id: true, firstName: true, lastName: true, avatar: true } },
};

/** The rating values a review may hold; drives the densified breakdown histogram. */
const RATING_VALUES = [1, 2, 3, 4, 5] as const;

/**
 * Re-derives a product's denormalized rating aggregate from its APPROVED
 * reviews and writes it back. Deliberately a FULL re-aggregation rather than
 * incremental delta arithmetic: deltas drift on repeated float math and are
 * simply wrong for transitions the caller didn't anticipate (REJECTED -> HIDDEN
 * must be a no-op, APPROVED -> HIDDEN a decrement). Re-aggregating is one
 * indexed query on Review(productId, status) and is self-healing — any drift,
 * from a raw-SQL write or a bulk import, corrects itself on the next
 * moderation event.
 *
 * Must be called inside the same transaction as the review mutation so the
 * aggregate can never disagree with the reviews a shopper can actually read.
 */
const recalculateProductRating = async (tx: Prisma.TransactionClient, productId: string) => {
    const aggregate = await tx.review.aggregate({
        where: { productId, status: ReviewStatus.APPROVED },
        _avg: { rating: true },
        _count: true,
    });

    await tx.product.update({
        where: { id: productId },
        data: {
            // _avg is null when no approved reviews remain — the spec requires
            // 0, not null, so a product with no reviews reads 0/0.
            averageRating: aggregate._avg.rating ?? 0,
            reviewCount: aggregate._count,
        },
    });
};

const createReview = async (userId: string, productId: string, payload: ICreateReviewPayload) => {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);

    const qualifyingOrderItem = await prisma.orderItem.findFirst({
        where: {
            productId,
            order: { customerId: customer.id, status: { in: QUALIFYING_ORDER_STATUSES } },
        },
    });

    if (!qualifyingOrderItem) {
        throw new AppError(
            status.FORBIDDEN,
            "You can only review products from a completed order",
        );
    }

    const existingReview = await prisma.review.findFirst({
        where: { productId, customerId: customer.id },
        select: { id: true },
    });

    if (existingReview) {
        throw new AppError(status.CONFLICT, "You have already reviewed this product");
    }

    return prisma.review.create({
        data: {
            productId,
            customerId: customer.id,
            rating: payload.rating,
            title: payload.title,
            comment: payload.comment,
        },
        include: REVIEW_INCLUDE,
    });
};

/**
 * Builds the rating summary for a product's public review list: the average and
 * total come from the denormalized Product columns (so the histogram and the
 * star rating rendered elsewhere can never disagree), while the per-star counts
 * are grouped per request — five columns on Product would be five more things
 * to keep in sync for a value only ever read on the detail page.
 */
const getRatingBreakdown = async (productId: string) => {
    const [product, grouped] = await Promise.all([
        prisma.product.findUnique({
            where: { id: productId },
            select: { averageRating: true, reviewCount: true },
        }),
        prisma.review.groupBy({
            by: ["rating"],
            where: { productId, status: ReviewStatus.APPROVED },
            _count: true,
        }),
    ]);

    // Densified: a rating nobody awarded must still appear with an explicit 0,
    // otherwise the storefront histogram renders gaps instead of empty bars.
    const counts = Object.fromEntries(RATING_VALUES.map((value) => [value, 0])) as Record<
        number,
        number
    >;

    for (const row of grouped) {
        counts[row.rating] = row._count;
    }

    return {
        average: Number(product?.averageRating ?? 0),
        total: product?.reviewCount ?? 0,
        counts,
    };
};

const getPublicProductReviews = async (productId: string, queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.review, queryParams, {
        filterableFields: ["rating"],
    });

    const [{ data, meta }, ratingBreakdown] = await Promise.all([
        queryBuilder
            .filter()
            .sort()
            .paginate()
            .where({ productId, status: ReviewStatus.APPROVED })
            .include(REVIEW_INCLUDE)
            .execute(),
        getRatingBreakdown(productId),
    ]);

    return { data, meta: { ...meta, ratingBreakdown } };
};

const getAdminReviews = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.review, queryParams, {
        filterableFields: ["status", "productId", "rating"],
    });

    return queryBuilder
        .filter()
        .sort()
        .paginate()
        .include({ ...REVIEW_INCLUDE, product: { select: { id: true, name: true, slug: true } } })
        .execute();
};

const getReviewOrThrow = async (id: string) => {
    const review = await prisma.review.findUnique({
        where: { id },
        include: { customer: { select: { userId: true } } },
    });
    if (!review) {
        throw new AppError(status.NOT_FOUND, "Review not found");
    }
    return review;
};

const updateReviewStatus = async (id: string, payload: IUpdateReviewStatusPayload) => {
    const existing = await getReviewOrThrow(id);

    // The status write and the aggregate recompute share a transaction: a
    // partial apply would leave the published average disagreeing with the
    // reviews it claims to summarise.
    const updated = await prisma.$transaction(async (tx) => {
        const review = await tx.review.update({
            where: { id },
            data: { status: payload.status },
            include: REVIEW_INCLUDE,
        });

        await recalculateProductRating(tx, existing.productId);

        return review;
    });

    if (existing.customer.userId) {
        await NotificationService.createNotification(
            existing.customer.userId,
            NotificationType.REVIEW,
            "Review status updated",
            `Your review is now ${payload.status}.`,
        );
    }

    return updated;
};

const replyToReview = async (id: string, payload: IAdminReplyPayload) => {
    const existing = await getReviewOrThrow(id);

    const updated = await prisma.review.update({
        where: { id },
        data: { adminReply: payload.adminReply },
        include: REVIEW_INCLUDE,
    });

    if (existing.customer.userId) {
        await NotificationService.createNotification(
            existing.customer.userId,
            NotificationType.REVIEW,
            "Admin replied to your review",
            payload.adminReply,
        );
    }

    return updated;
};

const getMyReviews = async (userId: string, queryParams: IQueryParams) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);

    const queryBuilder = new QueryBuilder(prisma.review, queryParams, {
        filterableFields: ["status", "rating", "productId"],
    });

    // No status filter: the whole point of this endpoint is that a customer can
    // see their own PENDING and REJECTED reviews, which the public list hides.
    return queryBuilder
        .filter()
        .sort()
        .paginate()
        .where({ customerId: customer.id })
        .include({ product: { select: { id: true, name: true, slug: true } } })
        .execute();
};

/**
 * Resolves a review that `userId` authored, or throws 404. Deliberately 404
 * (not 403) for someone else's review: a customer has no business learning
 * which review ids exist.
 */
const getOwnReviewOrThrow = async (userId: string, reviewId: string) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);

    const review = await prisma.review.findUnique({ where: { id: reviewId } });

    if (!review || review.customerId !== customer.id) {
        throw new AppError(status.NOT_FOUND, "Review not found");
    }

    return review;
};

const updateMyReview = async (
    userId: string,
    reviewId: string,
    payload: IUpdateMyReviewPayload,
) => {
    const existing = await getOwnReviewOrThrow(userId, reviewId);

    // Edited content must be re-moderated, and an unapproved review must not
    // keep contributing to the public rating — so an APPROVED review drops back
    // to PENDING and the aggregate is recomputed without it.
    const shouldResetToPending = existing.status === ReviewStatus.APPROVED;

    return prisma.$transaction(async (tx) => {
        const updated = await tx.review.update({
            where: { id: reviewId },
            data: {
                ...payload,
                ...(shouldResetToPending ? { status: ReviewStatus.PENDING } : {}),
            },
            include: REVIEW_INCLUDE,
        });

        await recalculateProductRating(tx, existing.productId);

        return updated;
    });
};

const deleteMyReview = async (userId: string, reviewId: string) => {
    const existing = await getOwnReviewOrThrow(userId, reviewId);

    await prisma.$transaction(async (tx) => {
        await tx.review.delete({ where: { id: reviewId } });
        await recalculateProductRating(tx, existing.productId);
    });
};

/**
 * Admin hard delete. Distinct from moderation (which only hides): this is for
 * content that must actually be removed. OWNER/ADMIN only — STAFF may moderate
 * status but not destroy content, matching the existing role gradient.
 */
const deleteReview = async (userId: string, reviewId: string) => {
    const existing = await prisma.review.findUnique({ where: { id: reviewId } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Review not found");
    }

    await prisma.$transaction(async (tx) => {
        await tx.review.delete({ where: { id: reviewId } });
        await recalculateProductRating(tx, existing.productId);
    });

    await AuditLogService.record(userId, AuditAction.DELETE, "Review", reviewId, {
        oldData: existing,
    });
};

export const ReviewService = {
    createReview,
    getPublicProductReviews,
    getAdminReviews,
    getMyReviews,
    updateMyReview,
    deleteMyReview,
    updateReviewStatus,
    replyToReview,
    deleteReview,
    recalculateProductRating,
};
