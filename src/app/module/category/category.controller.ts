import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { CategoryService } from "./category.service";

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
    createCategory,
    getPublicCategoryTree,
    getPublicCategoryBySlug,
    getAdminCategories,
    getAdminCategoryTree,
    getAdminCategoryById,
    updateCategory,
    deleteCategory,
};
