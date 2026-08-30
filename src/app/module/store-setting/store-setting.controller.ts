import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { StoreSettingService } from "./store-setting.service";

const getStoreSetting = catchAsync(async (req: Request, res: Response) => {
    const result = await StoreSettingService.getStoreSetting();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Store settings fetched successfully",
        data: result,
    });
});

const getPublicStoreSetting = catchAsync(async (req: Request, res: Response) => {
    const result = await StoreSettingService.getPublicStoreSetting();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Store settings fetched successfully",
        data: result,
    });
});

const updateStoreSetting = catchAsync(async (req: Request, res: Response) => {
    const result = await StoreSettingService.updateStoreSetting(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Store settings updated successfully",
        data: result,
    });
});

export const StoreSettingController = {
    getStoreSetting,
    getPublicStoreSetting,
    updateStoreSetting,
};
