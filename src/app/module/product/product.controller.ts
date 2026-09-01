import { Request, Response } from "express";
import status from "http-status";
import { uploadFileToCloudinary } from "../../config/cloudinary.config";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { IImageSlotInput, IProductImageInput } from "./product.interface";
import { ProductService } from "./product.service";
import { publicProductQueryZodSchema, searchProductsZodSchema } from "./product.validation";

/**
 * Uploads every file in `req.files` (multipart `images` field) to Cloudinary and merges the
 * results into `req.body.images`, matched by position to `req.body.imageSlots` (see
 * add-product-image-upload design.md Decision 1). All uploads resolve — or the whole request
 * throws — before the caller does anything else (Decision 4), so a mid-batch Cloudinary failure
 * never reaches ProductService. `imageSlots` is stripped from the payload afterward: it's a
 * controller-only field, never read by product.service.ts.
 *
 * A slot's `variantId`/`variantIndex` ride along with the rest of its metadata,
 * so a file uploaded and assigned to a variant in one request lands on that
 * variant without a follow-up edit (link-product-images-to-variants Decision 3).
 * The slot is typed as `IImageSlotInput` rather than an inline shape so a field
 * added there is carried here automatically instead of being silently dropped
 * by the spread below.
 */
const mergeUploadedImages = async (req: Request): Promise<void> => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const imageSlots = (req.body.imageSlots as IImageSlotInput[] | undefined) ?? [];

    if (files.length > 0) {
        const uploaded = await Promise.all(
            files.map((file) => uploadFileToCloudinary(file.buffer, file.originalname)),
        );

        // `url` is spread first so a slot can never override it. Slots are
        // zod-stripped to their declared fields, so this is defense in depth.
        const newImages: IProductImageInput[] = uploaded.map((result, i) => ({
            ...imageSlots[i],
            url: result.secure_url,
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

/**
 * Public product listing.
 *
 * Validated here rather than by the `validateRequest` middleware, which only
 * parses `req.body` and so never sees a GET's query string — same reason as
 * `searchProducts` below.
 *
 * The `sortBy` allowlist is the point: `QueryBuilder.sort()` has no whitelist,
 * so an unvalidated `sortBy` lets an anonymous caller order the catalog by a
 * column that appears in no public response (`costPrice`).
 */
const getPublicProducts = catchAsync(async (req: Request, res: Response) => {
    const parsed = publicProductQueryZodSchema.safeParse(req.query);

    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new AppError(
            status.BAD_REQUEST,
            issue?.message ?? "Invalid product query",
        );
    }

    const { data, meta } = await ProductService.getPublicProducts(
        parsed.data as IQueryParams & { isFeatured?: boolean },
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Products fetched successfully",
        data,
        meta,
    });
});

/**
 * Search-as-you-type suggestions.
 *
 * Validated here rather than by the `validateRequest` middleware, which only
 * parses `req.body` and so never sees a GET's query string.
 */
const searchProducts = catchAsync(async (req: Request, res: Response) => {
    const parsed = searchProductsZodSchema.safeParse(req.query);

    if (!parsed.success) {
        throw new AppError(
            status.BAD_REQUEST,
            parsed.error.issues[0]?.message ?? "Invalid search request",
        );
    }

    const result = await ProductService.searchProducts(parsed.data.q, parsed.data.limit);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Products fetched successfully",
        data: result,
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

const getRelatedProducts = catchAsync(async (req: Request, res: Response) => {
    const result = await ProductService.getRelatedProducts(
        req.params.slug as string,
        req.query.limit ? Number(req.query.limit) : undefined,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Related products fetched successfully",
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
    searchProducts,
    getPublicProductBySlug,
    getRelatedProducts,
    getAdminProducts,
    getAdminProductById,
    updateProduct,
    deleteProduct,
    addProductCategory,
    removeProductCategory,
};
