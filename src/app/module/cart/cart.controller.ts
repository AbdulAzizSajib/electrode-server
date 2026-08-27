import { Request, Response } from "express";
import status from "http-status";
import { APPLIED_COUPON_COOKIE, APPLIED_COUPON_COOKIE_OPTIONS } from "../coupon/coupon.constant";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { CookieUtils } from "../../utils/cookie";
import { CartService } from "./cart.service";

const GUEST_TOKEN_COOKIE = "guestToken";
const GUEST_TOKEN_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30 * 1000, // 30 days
};

const applyGuestTokenCookie = (res: Response, newGuestToken: string | undefined) => {
    if (newGuestToken) {
        CookieUtils.setCookie(res, GUEST_TOKEN_COOKIE, newGuestToken, GUEST_TOKEN_COOKIE_OPTIONS);
    }
};

const getCart = catchAsync(async (req: Request, res: Response) => {
    const appliedCouponCode = CookieUtils.getCookie(req, APPLIED_COUPON_COOKIE);

    const { cart, newGuestToken, discount } = await CartService.getCart(
        req.user?.userId,
        CookieUtils.getCookie(req, GUEST_TOKEN_COOKIE),
        appliedCouponCode,
    );
    applyGuestTokenCookie(res, newGuestToken);

    // A cookie naming a coupon that's no longer valid (expired mid-session, cart
    // dropped below minimumOrderAmount, etc.) is cleared rather than resurfaced.
    if (appliedCouponCode && !discount) {
        CookieUtils.clearCookie(res, APPLIED_COUPON_COOKIE, APPLIED_COUPON_COOKIE_OPTIONS);
    }

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Cart fetched successfully",
        data: { ...cart, discount },
    });
});

// Every mutation echoes back the same shape `getCart` returns — items and the
// re-validated `discount` — because clients render straight from this response
// instead of following it with a read (see cart.service.ts's reloadCart).
const addItem = catchAsync(async (req: Request, res: Response) => {
    const { cart, newGuestToken } = await CartService.addItem(
        req.user?.userId,
        CookieUtils.getCookie(req, GUEST_TOKEN_COOKIE),
        req.body,
        CookieUtils.getCookie(req, APPLIED_COUPON_COOKIE),
    );
    applyGuestTokenCookie(res, newGuestToken);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Item added to cart successfully",
        data: cart,
    });
});

const updateItemQuantity = catchAsync(async (req: Request, res: Response) => {
    const { cart, newGuestToken } = await CartService.updateItemQuantity(
        req.user?.userId,
        CookieUtils.getCookie(req, GUEST_TOKEN_COOKIE),
        req.params.itemId as string,
        req.body.quantity,
        CookieUtils.getCookie(req, APPLIED_COUPON_COOKIE),
    );
    applyGuestTokenCookie(res, newGuestToken);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Cart item updated successfully",
        data: cart,
    });
});

const removeItem = catchAsync(async (req: Request, res: Response) => {
    const { cart, newGuestToken } = await CartService.removeItem(
        req.user?.userId,
        CookieUtils.getCookie(req, GUEST_TOKEN_COOKIE),
        req.params.itemId as string,
        CookieUtils.getCookie(req, APPLIED_COUPON_COOKIE),
    );
    applyGuestTokenCookie(res, newGuestToken);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Item removed from cart successfully",
        data: cart,
    });
});

export const CartController = {
    getCart,
    addItem,
    updateItemQuantity,
    removeItem,
};
