import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { ProductService } from "./product.service";

const createProduct = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.createProduct(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Product created successfully",
        data: result,
    });
});

const getPublicProducts = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await ProductService.getPublicProducts(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Products fetched successfully",
        data,
        meta,
    });
});

const getPublicProductBySlug = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.getPublicProductBySlug(req.params.slug as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product fetched successfully",
        data: result,
    });
});

const getAdminProducts = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await ProductService.getAdminProducts(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Products fetched successfully",
        data,
        meta,
    });
});

const getAdminProductById = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.getAdminProductById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product fetched successfully",
        data: result,
    });
});

const updateProduct = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.updateProduct(req.user.userId, req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product updated successfully",
        data: result,
    });
});

const deleteProduct = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.deleteProduct(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product deleted successfully",
        data: result,
    });
});

const addProductCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.addProductCategory(
        req.params.id as string,
        req.params.categoryId as string,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Category added to product successfully",
        data: result,
    });
});

const removeProductCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.removeProductCategory(
        req.params.id as string,
        req.params.categoryId as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Category removed from product successfully",
        data: result,
    });
});

export const ProductController = {
    createProduct,
    getPublicProducts,
    getPublicProductBySlug,
    getAdminProducts,
    getAdminProductById,
    updateProduct,
    deleteProduct,
    addProductCategory,
    removeProductCategory,
};
