import { Request, Response } from "express";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { ICheckoutActor } from "../order/order.interface";
import { idempotencyKeyZodSchema } from "../order/order.validation";
import { LandingPageService } from "./landing-page.service";

const createLandingPage = catchAsync(async (req: Request, res: Response) => {
    const result = await LandingPageService.createLandingPage(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Landing page created successfully",
        data: result,
    });
});

const getAdminLandingPages = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await LandingPageService.getAdminLandingPages(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Landing pages fetched successfully",
        data,
        meta,
    });
});

const getLandingPageById = catchAsync(async (req: Request, res: Response) => {
    const result = await LandingPageService.getLandingPageOrThrow(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Landing page fetched successfully",
        data: result,
    });
});

const updateLandingPage = catchAsync(async (req: Request, res: Response) => {
    const result = await LandingPageService.updateLandingPage(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Landing page updated successfully",
        data: result,
    });
});

const deleteLandingPage = catchAsync(async (req: Request, res: Response) => {
    const result = await LandingPageService.deleteLandingPage(
        req.user.userId,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Landing page deleted successfully",
        data: result,
    });
});

const duplicateLandingPage = catchAsync(async (req: Request, res: Response) => {
    const result = await LandingPageService.duplicateLandingPage(
        req.user.userId,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Landing page duplicated successfully",
        data: result,
    });
});

/** The published pages the admin's active-page selector may offer. */
const getPublishedSummaries = catchAsync(async (_req: Request, res: Response) => {
    const result = await LandingPageService.getPublishedSummaries();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Landing pages fetched successfully",
        data: result,
    });
});

/**
 * Public read: PUBLISHED only.
 *
 * A DRAFT and a slug that does not exist are the same 404, so an unpublished
 * campaign cannot be found by anyone probing slugs.
 */
const getPublicLandingPage = catchAsync(async (req: Request, res: Response) => {
    const result = await LandingPageService.getPublishedBySlug(req.params.slug as string);

    if (!result) {
        throw new AppError(status.NOT_FOUND, "Landing page not found");
    }

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Landing page fetched successfully",
        data: result,
    });
});

/** Authenticated preview: any status, so a merchant can see a draft as a shopper would. */
const previewLandingPage = catchAsync(async (req: Request, res: Response) => {
    const result = await LandingPageService.getAnyBySlugForPreview(req.params.slug as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Landing page fetched successfully",
        data: result,
    });
});

/**
 * Prices the order as the shopper changes quantity or delivery area, so the
 * totals on the page are the server's own and cannot disagree with what is
 * charged.
 */
const quoteLandingPageOrder = catchAsync(async (req: Request, res: Response) => {
    const result = await LandingPageService.quoteLandingPageOrder(
        req.params.slug as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Order quoted successfully",
        data: result,
    });
});

const placeLandingPageOrder = catchAsync(async (req: Request, res: Response) => {
    // Header, not body — validateRequest only parses req.body. Absent is fine;
    // malformed is not, so parse rather than trust. Same handling as checkout.
    const parsedKey = idempotencyKeyZodSchema.safeParse(req.headers["idempotency-key"]);
    if (!parsedKey.success) {
        throw new AppError(status.BAD_REQUEST, "Idempotency-Key must be a UUID");
    }

    /*
     * ALWAYS a guest order, whether or not the visitor happens to have a
     * storefront session.
     *
     * A landing page has no login, no account menu and no address book — there
     * is no authenticated experience here to honour. Reading a session anyway
     * bought nothing and cost plenty: it made the page behave differently for
     * the merchant testing it (who is usually signed in) than for the ad
     * traffic it was built for, which is a class of bug that only ever shows up
     * in production. It also meant the per-IP cash-on-delivery cap silently did
     * not apply to those orders.
     *
     * Nothing is lost by ignoring the session. The guest path resolves the
     * customer BY PHONE, so an order from a number that already belongs to an
     * account still attaches to that account and still appears in its order
     * history — which is what the `commerce/landing-page-orders` spec asks for
     * ("the order is attached to that customer AND it is recorded as a guest
     * order").
     *
     * `guestToken` is deliberately not read: this path always orders from
     * payload items, so it never consults or clears the visitor's cart.
     *
     * No applied-coupon cookie is read either — a landing page has no coupon
     * box, and silently applying one the page never showed would charge a total
     * the page never quoted.
     */
    const actor: ICheckoutActor = { kind: "guest", ip: req.ip ?? "unknown" };

    const { order, isReplay } = await LandingPageService.placeLandingPageOrder(
        actor,
        req.params.slug as string,
        { ...req.body, idempotencyKey: parsedKey.data },
    );

    // 200 on a replay: nothing was created this time round, so a shopper who
    // double-tapped Submit gets their one order back rather than a second one.
    sendResponse(res, {
        httpStatusCode: isReplay ? status.OK : status.CREATED,
        success: true,
        message: isReplay ? "Order already placed" : "Order placed successfully",
        data: order,
    });
});

export const LandingPageController = {
    createLandingPage,
    getAdminLandingPages,
    getLandingPageById,
    updateLandingPage,
    deleteLandingPage,
    duplicateLandingPage,
    getPublishedSummaries,
    getPublicLandingPage,
    previewLandingPage,
    quoteLandingPageOrder,
    placeLandingPageOrder,
};
