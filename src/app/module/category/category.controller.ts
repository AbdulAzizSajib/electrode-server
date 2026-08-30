import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { uploadFileToCloudinary } from "../../config/cloudinary.config";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { CategoryService } from "./category.service";

/**
 * Uploads the multipart `image`/`banner` files to Cloudinary and puts the
 * resulting URLs on `req.body`, so the zod schema and the service downstream see
 * an ordinary URL payload and need no multipart awareness.
 *
 * Runs BEFORE validateRequest: a file only becomes a URL here — validating first
 * would reject a perfectly valid upload. Because it runs first, it also has to
 * unwrap the `data` JSON field itself (validateRequest would otherwise do that
 * later).
 *
 * A plain application/json request has no files and passes through untouched, so
 * supplying `image`/`banner` as pre-hosted URLs still works. Mirror of
 * `BannerController.mergeUploadedBannerImages`.
 */
const mergeUploadedCategoryImages = catchAsync(
    async (req: Request, _res: Response, next: NextFunction) => {
        if (typeof req.body?.data === "string") {
            req.body = JSON.parse(req.body.data);
        }

        const files = req.files as Record<string, Express.Multer.File[]> | undefined;

        for (const field of ["image", "banner"] as const) {
            const file = files?.[field]?.[0];

            if (!file) continue;

            // An empty file field (e.g. a form-data row left with no file picked)
            // would otherwise fail inside Cloudinary and surface as an opaque 500.
            if (file.size === 0) {
                throw new AppError(status.BAD_REQUEST, `Uploaded ${field} file is empty`);
            }

            const uploaded = await uploadFileToCloudinary(file.buffer, file.originalname);
            req.body[field] = uploaded.secure_url;
        }

        next();
    },
);

const createCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.createCategory(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Category created successfully",
        data: result,
    });
});

const getPublicCategoryTree = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.getPublicCategoryTree();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Categories fetched successfully",
        data: result,
    });
});

const getPublicCategoryBySlug = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.getPublicCategoryBySlug(req.params.slug as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Category fetched successfully",
        data: result,
    });
});

const getAdminCategories = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await CategoryService.getAdminCategories(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Categories fetched successfully",
        data,
        meta,
    });
});

const getAdminCategoryTree = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.getAdminCategoryTree();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Category tree fetched successfully",
        data: result,
    });
});

const getAdminCategoryById = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.getAdminCategoryById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Category fetched successfully",
        data: result,
    });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.updateCategory(req.user.userId, req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Category updated successfully",
        data: result,
    });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await CategoryService.deleteCategory(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Category deleted successfully",
        data: result,
    });
});

export const CategoryController = {
    mergeUploadedCategoryImages,
    createCategory,
    getPublicCategoryTree,
    getPublicCategoryBySlug,
    getAdminCategories,
    getAdminCategoryTree,
    getAdminCategoryById,
    updateCategory,
    deleteCategory,
};
