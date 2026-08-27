import { Request, Response } from "express";
import status from "http-status";
import { uploadFileToCloudinary } from "../../config/cloudinary.config";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { IProductImageInput } from "./product.interface";
import { ProductService } from "./product.service";

/**
 * Uploads every file in `req.files` (multipart `images` field) to Cloudinary and merges the
 * results into `req.body.images`, matched by position to `req.body.imageSlots` (see
 * add-product-image-upload design.md Decision 1). All uploads resolve — or the whole request
 * throws — before the caller does anything else (Decision 4), so a mid-batch Cloudinary failure
 * never reaches ProductService. `imageSlots` is stripped from the payload afterward: it's a
 * controller-only field, never read by product.service.ts.
 */
const mergeUploadedImages = async (req: Request): Promise<void> => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const imageSlots = (req.body.imageSlots as { altText?: string; sortOrder?: number; isPrimary?: boolean }[] | undefined) ?? [];

    if (files.length > 0) {
        const uploaded = await Promise.all(
            files.map((file) => uploadFileToCloudinary(file.buffer, file.originalname)),
        );

        const newImages: IProductImageInput[] = uploaded.map((result, i) => ({
            url: result.secure_url,
            ...imageSlots[i],
        }));

        const existingImages = (req.body.images as IProductImageInput[] | undefined) ?? [];
        req.body.images = [...existingImages, ...newImages];
    }

    delete req.body.imageSlots;
};

const createProduct = catchAsync(async (req: Request, res: Response) => {
    await mergeUploadedImages(req);

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
    await mergeUploadedImages(req);

    const result = await ProductService.updateProduct(req.user.userId, req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Product updated successfully",
        data: result,
    });
});

const deleteProduct = catchAsync(async (req: Request, res: Response) => {
    const { product, archived, orderItemCount, purchaseOrderItemCount } =
        await ProductService.deleteProduct(req.user.userId, req.params.id as string);

    const references = [
        orderItemCount > 0 ? `${orderItemCount} order item(s)` : null,
        purchaseOrderItemCount > 0 ? `${purchaseOrderItemCount} purchase order item(s)` : null,
    ]
        .filter(Boolean)
        .join(" and ");

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: archived
            ? `Product is referenced by ${references}, so it was archived instead of deleted. It is now hidden from the storefront.`
            : "Product deleted successfully",
        data: product,
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
