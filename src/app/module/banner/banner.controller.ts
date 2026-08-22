import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { BannerService } from "./banner.service";

const createBanner = catchAsync(async (req: Request, res: Response) => {
    const result = await BannerService.createBanner(req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Banner created successfully",
        data: result,
    });
});

const getPublicBanners = catchAsync(async (req: Request, res: Response) => {
    const result = await BannerService.getPublicBanners();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Banners fetched successfully",
        data: result,
    });
});

const getAdminBanners = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await BannerService.getAdminBanners(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Banners fetched successfully",
        data,
        meta,
    });
});

const getBannerById = catchAsync(async (req: Request, res: Response) => {
    const result = await BannerService.getBannerOrThrow(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Banner fetched successfully",
        data: result,
    });
});

const updateBanner = catchAsync(async (req: Request, res: Response) => {
    const result = await BannerService.updateBanner(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Banner updated successfully",
        data: result,
    });
});

const deleteBanner = catchAsync(async (req: Request, res: Response) => {
    const result = await BannerService.deleteBanner(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Banner deleted successfully",
        data: result,
    });
});

export const BannerController = {
    createBanner,
    getPublicBanners,
    getAdminBanners,
    getBannerById,
    updateBanner,
    deleteBanner,
};
