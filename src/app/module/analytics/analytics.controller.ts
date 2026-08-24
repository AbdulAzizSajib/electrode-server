import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { AnalyticsService } from "./analytics.service";
import { IDashboardRange } from "./analytics.interface";

const VALID_RANGES: IDashboardRange[] = ["7d", "30d", "90d"];

const resolveRange = (req: Request): IDashboardRange => {
    const requested = req.query.range as string | undefined;
    return VALID_RANGES.includes(requested as IDashboardRange) ? (requested as IDashboardRange) : "30d";
};

const getDashboardSummary = catchAsync(async (req: Request, res: Response) => {
    const result = await AnalyticsService.getDashboardSummary(resolveRange(req));

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Dashboard summary fetched successfully",
        data: result,
    });
});

const getTopProducts = catchAsync(async (req: Request, res: Response) => {
    const result = await AnalyticsService.getTopProducts(resolveRange(req));

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Top products fetched successfully",
        data: result,
    });
});

const getSalesByCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await AnalyticsService.getSalesByCategory(resolveRange(req));

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Sales by category fetched successfully",
        data: result,
    });
});

const getOrderStatusBreakdown = catchAsync(async (req: Request, res: Response) => {
    const result = await AnalyticsService.getOrderStatusBreakdown(resolveRange(req));

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Order status breakdown fetched successfully",
        data: result,
    });
});

const getPaymentBreakdown = catchAsync(async (req: Request, res: Response) => {
    const result = await AnalyticsService.getPaymentBreakdown(resolveRange(req));

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Payment breakdown fetched successfully",
        data: result,
    });
});

const getReturnsRefunds = catchAsync(async (req: Request, res: Response) => {
    const result = await AnalyticsService.getReturnsRefunds(resolveRange(req));

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Returns/refunds summary fetched successfully",
        data: result,
    });
});

export const AnalyticsController = {
    getDashboardSummary,
    getTopProducts,
    getSalesByCategory,
    getOrderStatusBreakdown,
    getPaymentBreakdown,
    getReturnsRefunds,
};
