import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { BrandService } from "./brand.service";

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
    createBrand,
    bulkCreateBrands,
    getPublicBrands,
    getPublicBrandBySlug,
    getAdminBrands,
    getAdminBrandById,
    updateBrand,
    deleteBrand,
};
