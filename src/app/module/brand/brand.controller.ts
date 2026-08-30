import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { uploadFileToCloudinary } from "../../config/cloudinary.config";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { BrandService } from "./brand.service";

/**
 * Uploads the multipart `logo` file to Cloudinary and puts the resulting URL on
 * `req.body.logo`, so the zod schema and the service downstream see an ordinary
 * URL payload and need no multipart awareness.
 *
 * Runs BEFORE validateRequest: a logo file only becomes a URL here — validating
 * first would reject a perfectly valid upload. Because it runs first, it also has
 * to unwrap the `data` JSON field itself (validateRequest would otherwise do that
 * later).
 *
 * A plain application/json request has no file and passes through untouched, so
 * supplying `logo` as a pre-hosted URL still works. Mirror of
 * `BannerController.mergeUploadedBannerImages`.
 */
const mergeUploadedBrandLogo = catchAsync(
    async (req: Request, _res: Response, next: NextFunction) => {
        if (typeof req.body?.data === "string") {
            req.body = JSON.parse(req.body.data);
        }

        const file = req.file;

        if (!file) {
            next();
            return;
        }

        // An empty file field (e.g. a form-data row left with no file picked)
        // would otherwise fail inside Cloudinary and surface as an opaque 500.
        if (file.size === 0) {
            throw new AppError(status.BAD_REQUEST, "Uploaded logo file is empty");
        }

        const uploaded = await uploadFileToCloudinary(file.buffer, file.originalname);
        req.body.logo = uploaded.secure_url;

        next();
    },
);

const createBrand = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.createBrand(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Brand created successfully",
        data: result,
    });
});

const bulkCreateBrands = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.bulkCreateBrands(req.user.userId, req.body.names);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: `${result.created.length} brand(s) created, ${result.skipped.length} skipped`,
        data: result,
    });
});

const getPublicBrands = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await BrandService.getPublicBrands(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Brands fetched successfully",
        data,
        meta,
    });
});

const getPublicBrandBySlug = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.getPublicBrandBySlug(req.params.slug as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Brand fetched successfully",
        data: result,
    });
});

const getAdminBrands = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await BrandService.getAdminBrands(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Brands fetched successfully",
        data,
        meta,
    });
});

const getAdminBrandById = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.getAdminBrandById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Brand fetched successfully",
        data: result,
    });
});

const updateBrand = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.updateBrand(req.user.userId, req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Brand updated successfully",
        data: result,
    });
});

const deleteBrand = catchAsync(async (req: Request, res: Response) => {
    const result = await BrandService.deleteBrand(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Brand deleted successfully",
        data: result,
    });
});

export const BrandController = {
    mergeUploadedBrandLogo,
    createBrand,
    bulkCreateBrands,
    getPublicBrands,
    getPublicBrandBySlug,
    getAdminBrands,
    getAdminBrandById,
    updateBrand,
    deleteBrand,
};
