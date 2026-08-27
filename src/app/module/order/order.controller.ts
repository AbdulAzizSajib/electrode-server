import { Request, Response } from "express";
import status from "http-status";
import { APPLIED_COUPON_COOKIE, APPLIED_COUPON_COOKIE_OPTIONS } from "../coupon/coupon.constant";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { CookieUtils } from "../../utils/cookie";
import { OrderService } from "./order.service";
import { idempotencyKeyZodSchema } from "./order.validation";

const placeOrder = catchAsync(async (req: Request, res: Response) => {
    // Whatever coupon is applied to the customer's cart (see coupon.constant.ts)
    // rides along into checkout automatically — the client never resends it.
    const appliedCouponCode = CookieUtils.getCookie(req, APPLIED_COUPON_COOKIE);

    // Header, not body — so validateRequest never sees it (it only parses
    // req.body). Absent is fine; malformed is not, so parse rather than trust.
    const parsedKey = idempotencyKeyZodSchema.safeParse(req.headers["idempotency-key"]);
    if (!parsedKey.success) {
        throw new AppError(status.BAD_REQUEST, "Idempotency-Key must be a UUID");
    }

    const { order, isReplay } = await OrderService.placeOrder(req.user.userId, {
        ...req.body,
        couponCode: appliedCouponCode,
        idempotencyKey: parsedKey.data,
    });

    // The cart is cleared on a successful order (see order.service.ts) — its
    // applied coupon no longer applies to whatever's left in the (now empty) cart.
    if (appliedCouponCode) {
        CookieUtils.clearCookie(res, APPLIED_COUPON_COOKIE, APPLIED_COUPON_COOKIE_OPTIONS);
    }

    // 200 on a replay: nothing was created this time round, and a client that
    // distinguishes the two can tell its retry was absorbed rather than acted on.
    sendResponse(res, {
        httpStatusCode: isReplay ? status.OK : status.CREATED,
        success: true,
        message: isReplay ? "Order already placed" : "Order placed successfully",
        data: order,
    });
});

const getOrders = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await OrderService.getOrders(
        req.user.userId,
        req.user.role,
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Orders fetched successfully",
        data,
        meta,
    });
});

const getOrderById = catchAsync(async (req: Request, res: Response) => {
    const result = await OrderService.getOrderById(
        req.user.userId,
        req.user.role,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Order fetched successfully",
        data: result,
    });
});

const cancelOrder = catchAsync(async (req: Request, res: Response) => {
    const result = await OrderService.cancelOwnOrder(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Order cancelled successfully",
        data: result,
    });
});

const updateOrderStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await OrderService.updateOrderStatus(
        req.params.id as string,
        req.body,
        req.user.userId,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Order status updated successfully",
        data: result,
    });
});

export const OrderController = {
    placeOrder,
    getOrders,
    getOrderById,
    cancelOrder,
    updateOrderStatus,
};
