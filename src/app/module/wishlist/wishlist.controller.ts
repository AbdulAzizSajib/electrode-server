import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { WishlistService } from "./wishlist.service";

const getMyWishlist = catchAsync(async (req: Request, res: Response) => {
    const result = await WishlistService.getMyWishlist(req.user.userId);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Wishlist fetched successfully",
        data: result,
    });
});

const addItem = catchAsync(async (req: Request, res: Response) => {
    const result = await WishlistService.addItem(req.user.userId, req.body.productId);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Item added to wishlist successfully",
        data: result,
    });
});

const removeItem = catchAsync(async (req: Request, res: Response) => {
    const result = await WishlistService.removeItem(req.user.userId, req.params.itemId as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Item removed from wishlist successfully",
        data: result,
    });
});

export const WishlistController = {
    getMyWishlist,
    addItem,
    removeItem,
};
