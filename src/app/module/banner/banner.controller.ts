import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { uploadFileToCloudinary } from "../../config/cloudinary.config";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { BannerService } from "./banner.service";
import { publicBannerQueryZodSchema } from "./banner.validation";

/**
 * Uploads the multipart `image`/`mobileImage` files to Cloudinary and puts the
 * resulting URLs on `req.body`, so the zod schema and the service downstream see
 * an ordinary URL payload and need no multipart awareness.
 *
 * Runs BEFORE validateRequest: the type contract requires `image` for an IMAGE
 * banner, and an uploaded file only becomes a URL here — validating first would
 * reject a perfectly valid upload. Because it runs first, it also has to unwrap
 * the `data` JSON field itself (validateRequest would otherwise do that later).
 *
 * A plain application/json request has no files and passes through untouched, so
 * supplying `image` as a pre-hosted URL still works.
 */
const mergeUploadedBannerImages = catchAsync(
    async (req: Request, _res: Response, next: NextFunction) => {
        if (typeof req.body?.data === "string") {
            req.body = JSON.parse(req.body.data);
        }

        const files = req.files as Record<string, Express.Multer.File[]> | undefined;

        for (const field of ["image", "mobileImage"] as const) {
            const file = files?.[field]?.[0];

            if (!file) continue;

            // An empty file field (e.g. a form-data row left with no file picked)
            // would otherwise fail inside Cloudinary and surface as a opaque 500.
            if (file.size === 0) {
                throw new AppError(status.BAD_REQUEST, `Uploaded ${field} file is empty`);
            }

            const uploaded = await uploadFileToCloudinary(file.buffer, file.originalname);
            req.body[field] = uploaded.secure_url;
        }

        next();
    },
);

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
    // Throws on an unknown placement; catchAsync routes the ZodError to
    // globalErrorHandler, which renders it as a 400.
    const { placement } = publicBannerQueryZodSchema.parse(req.query);

    const result = await BannerService.getPublicBanners(placement);

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
    mergeUploadedBannerImages,
    createBanner,
    getPublicBanners,
    getAdminBanners,
    getBannerById,
    updateBanner,
    deleteBanner,
};
