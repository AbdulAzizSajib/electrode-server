import { Request, Response } from "express";
import status from "http-status";
import { APPLIED_COUPON_COOKIE, APPLIED_COUPON_COOKIE_OPTIONS } from "../coupon/coupon.constant";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { CookieUtils } from "../../utils/cookie";
import { GUEST_TOKEN_COOKIE } from "../cart/cart.constant";
import { ICheckoutActor } from "./order.interface";
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

    // `optionalAuth` leaves `req.user` unset for a guest rather than throwing,
    // so which flow this is comes down to whether a session resolved. A guest
    // is identified by their cart cookie (if they have one) and their IP, which
    // the order records to back the per-IP rate limit.
    const actor: ICheckoutActor = req.user
        ? { kind: "user", userId: req.user.userId }
        : {
              kind: "guest",
              guestToken: CookieUtils.getCookie(req, GUEST_TOKEN_COOKIE),
              ip: req.ip ?? "unknown",
          };

    const { order, isReplay } = await OrderService.placeOrder(actor, {
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

/**
 * Prices the basket without placing anything, so checkout can show what
 * delivery actually costs to the shopper's destination — and tell them up front
 * when nobody delivers there — instead of guessing and being corrected by the
 * server after Place Order.
 */
const quoteCheckout = catchAsync(async (req: Request, res: Response) => {
    const appliedCouponCode = CookieUtils.getCookie(req, APPLIED_COUPON_COOKIE);

    const actor: ICheckoutActor = req.user
        ? { kind: "user", userId: req.user.userId }
        : {
              kind: "guest",
              guestToken: CookieUtils.getCookie(req, GUEST_TOKEN_COOKIE),
              ip: req.ip ?? "unknown",
          };

    const quote = await OrderService.quoteCheckout(actor, {
        ...req.body,
        couponCode: appliedCouponCode,
    });

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Checkout quote calculated",
        data: quote,
    });
});

/**
 * Records an order a customer placed off-site — the seller's side of a WhatsApp
 * or Messenger conversation.
 *
 * Two values are taken from outside the body on purpose, and neither may ever
 * move into it: the operator's id, which comes from the verified session so an
 * order cannot claim to have been taken by someone else, and the idempotency
 * key, which is a header for the same reason it is one at checkout.
 *
 * No applied-coupon cookie is read here, unlike `placeOrder` above. A manual
 * order takes a stated discount instead of a coupon, and picking up whatever
 * coupon happened to be sitting in the OPERATOR'S OWN browser would apply a
 * discount nobody agreed to — the cookie belongs to whoever last shopped in
 * that browser, which on a shared shop machine is anybody.
 */
const placeManualOrder = catchAsync(async (req: Request, res: Response) => {
    const parsedKey = idempotencyKeyZodSchema.safeParse(req.headers["idempotency-key"]);
    if (!parsedKey.success) {
        throw new AppError(status.BAD_REQUEST, "Idempotency-Key must be a UUID");
    }

    const { order, isReplay } = await OrderService.placeManualOrder(req.user.userId, {
        ...req.body,
        idempotencyKey: parsedKey.data,
    });

    // 200 on a replay, matching checkout: an operator's double click is absorbed
    // rather than acted on, and a client that reads the status can tell.
    sendResponse(res, {
        httpStatusCode: isReplay ? status.OK : status.CREATED,
        success: true,
        message: isReplay ? "Order already recorded" : "Order recorded successfully",
        data: order,
    });
});

/**
 * Prices an order an operator is still typing, so they can read the total back
 * to the customer before committing to it.
 *
 * A separate handler from `quoteCheckout` rather than a branch inside it. That
 * one runs under `optionalAuth` and builds a `user` actor from any session —
 * which is correct, because an ADMIN shopping on the storefront is a shopper
 * like any other and their own cart should price. Deciding the actor by role
 * there would break that. Here the actor is staff because the ROUTE is staff,
 * which is a property of the endpoint rather than a guess about the person.
 */
const quoteManualOrder = catchAsync(async (req: Request, res: Response) => {
    const quote = await OrderService.quoteCheckout(
        { kind: "staff", staffUserId: req.user.userId },
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Manual order quote calculated",
        data: quote,
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

/**
 * Guest order tracking. POST rather than GET so the phone number travels in
 * the body — a query string lands in access logs, browser history and
 * referrer headers, and here it is half the credential.
 */
const getGuestOrder = catchAsync(async (req: Request, res: Response) => {
    const result = await OrderService.getGuestOrderByNumberAndPhone(
        req.body.orderNumber,
        req.body.phone,
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
    placeManualOrder,
    quoteCheckout,
    quoteManualOrder,
    getOrders,
    getOrderById,
    getGuestOrder,
    cancelOrder,
    updateOrderStatus,
};
