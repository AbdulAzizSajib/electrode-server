import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { ICourierActor } from "./courier.interface";
import { CourierService } from "./courier.service";

const actorFrom = (req: Request): ICourierActor => ({
    userId: req.user!.userId,
    role: req.user!.role,
    email: req.user!.email,
});

const previewDispatch = catchAsync(async (req: Request, res: Response) => {
    const result = await CourierService.previewDispatch(req.body.orderIds);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: `${result.filter((r) => r.eligible).length} of ${result.length} orders can be dispatched`,
        data: result,
    });
});

const dispatchOrders = catchAsync(async (req: Request, res: Response) => {
    const result = await CourierService.dispatchOrders(req.body.orderIds, actorFrom(req));

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: `${result.dispatched} dispatched, ${result.ineligible} skipped, ${result.failed} failed, ${result.unconfirmed} unconfirmed`,
        data: result,
    });
});

const getBalance = catchAsync(async (_req: Request, res: Response) => {
    const result = await CourierService.getBalance();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Courier balance retrieved",
        data: result,
    });
});

const createReturnRequest = catchAsync(async (req: Request, res: Response) => {
    const result = await CourierService.createReturnRequest(
        req.params.id as string,
        req.body.reason,
    );

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Return request raised with the courier",
        data: result,
    });
});

/**
 * The courier's webhook.
 *
 * Always answers 200 once the token has been accepted and the payload parsed,
 * including for a consignment this system does not hold. Steadfast is not at
 * fault for that, and an error response would only invite retries of something
 * that can never succeed.
 *
 * The response body matches the shape their documentation asks for.
 */
const handleWebhook = catchAsync(async (req: Request, res: Response) => {
    const result = await CourierService.handleWebhook(req.body);

    res.status(status.OK).json({
        status: "success",
        message: result.matched
            ? "Webhook received successfully."
            : "Webhook received; no matching consignment.",
    });
});

/**
 * Reconciliation, called by Vercel Cron.
 *
 * Not `sendResponse` — nothing human reads this, and the counts are what a cron
 * log needs to show whether the job is finding anything.
 */
const runReconciliation = catchAsync(async (_req: Request, res: Response) => {
    const result = await CourierService.reconcileQuietConsignments();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: `Checked ${result.checked} consignments, updated ${result.updated}, failed ${result.failed}`,
        data: result,
    });
});

export const CourierController = {
    previewDispatch,
    dispatchOrders,
    getBalance,
    createReturnRequest,
    handleWebhook,
    runReconciliation,
};
