import { Request, Response } from "express";
import status from "http-status";
import { APPLIED_COUPON_COOKIE } from "../coupon/coupon.constant";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { CookieUtils } from "../../utils/cookie";
import { IAddWishlistItemPayload } from "./wishlist.interface";
import { WishlistService } from "./wishlist.service";

const getMyWishlist = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await WishlistService.getMyWishlist(
        req.user.userId,
        req.query.page ? Number(req.query.page) : undefined,
        req.query.limit ? Number(req.query.limit) : undefined,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Wishlist fetched successfully",
        data,
        meta,
    });
});

const getWishlistCount = catchAsync(async (req: Request, res: Response) => {
    const result = await WishlistService.getWishlistCount(req.user.userId);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Wishlist count fetched successfully",
        data: result,
    });
});

const containsProduct = catchAsync(async (req: Request, res: Response) => {
    const result = await WishlistService.containsProduct(
        req.user.userId,
        req.params.productId as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Wishlist membership checked successfully",
        data: result,
    });
});

const addItem = catchAsync(async (req: Request, res: Response) => {
    const { productId } = req.body as IAddWishlistItemPayload;
    const { data, meta } = await WishlistService.addItem(req.user.userId, productId);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Item added to wishlist successfully",
        data,
        meta,
    });
});

const removeItem = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await WishlistService.removeItem(
        req.user.userId,
        req.params.itemId as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Item removed from wishlist successfully",
        data,
        meta,
    });
});

const removeItemByProduct = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await WishlistService.removeItemByProduct(
        req.user.userId,
        req.params.productId as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Item removed from wishlist successfully",
        data,
        meta,
    });
});

const moveItemToCart = catchAsync(async (req: Request, res: Response) => {
    const result = await WishlistService.moveItemToCart(
        req.user.userId,
        req.params.itemId as string,
        CookieUtils.getCookie(req, APPLIED_COUPON_COOKIE),
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Item moved to cart successfully",
        data: result,
    });
});

export const WishlistController = {
    getMyWishlist,
    getWishlistCount,
    containsProduct,
    addItem,
    removeItem,
    removeItemByProduct,
    moveItemToCart,
};
