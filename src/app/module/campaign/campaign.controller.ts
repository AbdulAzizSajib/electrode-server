import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { CampaignService } from "./campaign.service";

const createCampaign = catchAsync(async (req: Request, res: Response) => {
    const result = await CampaignService.createCampaign(req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Campaign created successfully",
        data: result,
    });
});

const getAdminCampaigns = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await CampaignService.getAdminCampaigns(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Campaigns fetched successfully",
        data,
        meta,
    });
});

const getCampaignById = catchAsync(async (req: Request, res: Response) => {
    const result = await CampaignService.getCampaignOrThrow(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Campaign fetched successfully",
        data: result,
    });
});

const updateCampaign = catchAsync(async (req: Request, res: Response) => {
    const result = await CampaignService.updateCampaign(req.params.id as string, req.body);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Campaign updated successfully",
        data: result,
    });
});

const deleteCampaign = catchAsync(async (req: Request, res: Response) => {
    const result = await CampaignService.deleteCampaign(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Campaign deleted successfully",
        data: result,
    });
});

export const CampaignController = {
    createCampaign,
    getAdminCampaigns,
    getCampaignById,
    updateCampaign,
    deleteCampaign,
};
