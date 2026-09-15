import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { StorageService } from "./storage.service";

const getStorageUsage = catchAsync(async (_req: Request, res: Response) => {
    const result = await StorageService.getStorageUsage();

    /*
     * Always 200, even when one half failed.
     *
     * The service returns a partial answer by design, and the per-half error
     * fields carry the reason. A 5xx here would discard the half that succeeded
     * and leave the page with nothing to show.
     */
    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Storage usage fetched successfully",
        data: result,
    });
});

export const StorageController = {
    getStorageUsage,
};
