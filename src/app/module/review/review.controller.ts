import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { ReviewService } from "./review.service";

const createReview = catchAsync(async (req: Request, res: Response) => {
    const result = await ReviewService.createReview(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Review submitted successfully — it will be visible after moderation",
        data: result,
    });
});

const getPublicProductReviews = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await ReviewService.getPublicProductReviews(
        req.params.id as string,
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Reviews fetched successfully",
        data,
        meta,
    });
});

const getAdminReviews = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await ReviewService.getAdminReviews(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Reviews fetched successfully",
        data,
        meta,
    });
});

const updateReviewStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await ReviewService.updateReviewStatus(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Review status updated successfully",
        data: result,
    });
});

const replyToReview = catchAsync(async (req: Request, res: Response) => {
    const result = await ReviewService.replyToReview(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Reply added to review successfully",
        data: result,
    });
});

export const ReviewController = {
    createReview,
    getPublicProductReviews,
    getAdminReviews,
    updateReviewStatus,
    replyToReview,
};
