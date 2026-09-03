import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import {
    ICreateBundleDealPayload,
    IUpdateBundleDealPayload,
} from "./bundle-deal.interface";
import { BundleDealService } from "./bundle-deal.service";

/** `?force=1` confirms deleting an offer products still carry. */
const isForced = (req: Request) => req.query.force === "1" || req.query.force === "true";

const createBundleDeal = catchAsync(async (req: Request, res: Response) => {
    const result = await BundleDealService.createBundleDeal(
        req.user.userId,
        req.body as ICreateBundleDealPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Bundle deal created successfully",
        data: result,
    });
});

const updateBundleDeal = catchAsync(async (req: Request, res: Response) => {
    const result = await BundleDealService.updateBundleDeal(
        req.user.userId,
        req.params.id as string,
        req.body as IUpdateBundleDealPayload,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Bundle deal updated successfully",
        data: result,
    });
});

const deleteBundleDeal = catchAsync(async (req: Request, res: Response) => {
    const result = await BundleDealService.deleteBundleDeal(
        req.user.userId,
        req.params.id as string,
        { force: isForced(req) },
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message:
            result.affectedProducts > 0
                ? `Bundle deal deleted. ${result.affectedProducts} product(s) are now sold without an offer.`
                : "Bundle deal deleted successfully",
        data: result.bundleDeal,
    });
});

const getBundleDeals = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await BundleDealService.getBundleDeals(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Bundle deals fetched successfully",
        data,
        meta,
    });
});

const getBundleDealById = catchAsync(async (req: Request, res: Response) => {
    const result = await BundleDealService.getBundleDealById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Bundle deal fetched successfully",
        data: result,
    });
});

const getAllBundleDeals = catchAsync(async (_req: Request, res: Response) => {
    const result = await BundleDealService.getAllBundleDeals();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Bundle deals fetched successfully",
        data: result,
    });
});

export const BundleDealController = {
    createBundleDeal,
    updateBundleDeal,
    deleteBundleDeal,
    getBundleDeals,
    getBundleDealById,
    getAllBundleDeals,
};
