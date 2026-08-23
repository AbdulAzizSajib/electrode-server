import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { AnalyticsService } from "./analytics.service";
import { IDashboardRange } from "./analytics.interface";

const VALID_RANGES: IDashboardRange[] = ["7d", "30d", "90d"];

const getDashboardSummary = catchAsync(async (req: Request, res: Response) => {
    const requested = req.query.range as string | undefined;
    const range: IDashboardRange = VALID_RANGES.includes(requested as IDashboardRange)
        ? (requested as IDashboardRange)
        : "30d";

    const result = await AnalyticsService.getDashboardSummary(range);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Dashboard summary fetched successfully",
        data: result,
    });
});

export const AnalyticsController = {
    getDashboardSummary,
};
