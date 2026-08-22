import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { NotificationType, OrderStatus, ReviewStatus } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { CustomerService } from "../customer/customer.service";
import { NotificationService } from "../notification/notification.service";
import {
    IAdminReplyPayload,
    ICreateReviewPayload,
    IUpdateReviewStatusPayload,
} from "./review.interface";

/** Order states that count as "the purchase actually happened" for the verified-purchaser check. */
const QUALIFYING_ORDER_STATUSES: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.COMPLETED];

const REVIEW_INCLUDE = {
    customer: { select: { id: true, firstName: true, lastName: true, avatar: true } },
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

const getPublicProductReviews = async (productId: string, queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.review, queryParams, {
        filterableFields: ["rating"],
    });

    return queryBuilder
        .filter()
        .sort()
        .paginate()
        .where({ productId, status: ReviewStatus.APPROVED })
        .include(REVIEW_INCLUDE)
        .execute();
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

    const updated = await prisma.review.update({
        where: { id },
        data: { status: payload.status },
        include: REVIEW_INCLUDE,
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

export const ReviewService = {
    createReview,
    getPublicProductReviews,
    getAdminReviews,
    updateReviewStatus,
    replyToReview,
};
