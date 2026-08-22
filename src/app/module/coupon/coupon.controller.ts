import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { CookieUtils } from "../../utils/cookie";
import { APPLIED_COUPON_COOKIE, APPLIED_COUPON_COOKIE_OPTIONS } from "./coupon.constant";
import { CouponService } from "./coupon.service";

const createCoupon = catchAsync(async (req: Request, res: Response) => {
    const result = await CouponService.createCoupon(req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Coupon created successfully",
        data: result,
    });
});

const getAdminCoupons = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await CouponService.getAdminCoupons(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Coupons fetched successfully",
        data,
        meta,
    });
});

const getCouponById = catchAsync(async (req: Request, res: Response) => {
    const result = await CouponService.getCouponOrThrow(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Coupon fetched successfully",
        data: result,
    });
});

const updateCoupon = catchAsync(async (req: Request, res: Response) => {
    const result = await CouponService.updateCoupon(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Coupon updated successfully",
        data: result,
    });
});

const deleteCoupon = catchAsync(async (req: Request, res: Response) => {
    const result = await CouponService.deleteCoupon(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Coupon deleted successfully",
        data: result,
    });
});

const applyCoupon = catchAsync(async (req: Request, res: Response) => {
    const result = await CouponService.applyCouponToCart(
        req.user?.userId,
        CookieUtils.getCookie(req, "guestToken"),
        req.body.code,
    );

    CookieUtils.setCookie(res, APPLIED_COUPON_COOKIE, result.coupon.code, APPLIED_COUPON_COOKIE_OPTIONS);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Coupon applied successfully",
        data: {
            cart: result.cart,
            coupon: result.coupon,
            discountAmount: result.discountAmount,
            freeShipping: result.freeShipping,
            subtotal: result.subtotal,
        },
    });
});

const removeCoupon = catchAsync(async (req: Request, res: Response) => {
    CookieUtils.clearCookie(res, APPLIED_COUPON_COOKIE, APPLIED_COUPON_COOKIE_OPTIONS);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Coupon removed from cart successfully",
    });
});

export const CouponController = {
    createCoupon,
    getAdminCoupons,
    getCouponById,
    updateCoupon,
    deleteCoupon,
    applyCoupon,
    removeCoupon,
};
