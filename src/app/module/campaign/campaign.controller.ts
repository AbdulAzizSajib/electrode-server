import { Request, Response } from "express";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { ProductService } from "../product/product.service";
import { CampaignService } from "./campaign.service";
import { activeCampaignQueryZodSchema } from "./campaign.validation";

/**
 * The campaign occupying a storefront slot — the only public campaign route.
 *
 * Validated here rather than by `validateRequest`, which parses `req.body` and
 * so never sees a GET's query string (same reason as the product listing).
 *
 * Served by `ProductService` because the response needs campaign *pricing*,
 * which lives with the product read path; campaign.service cannot reach it
 * without an import cycle.
 *
 * An unoccupied slot is `data: null` with a 200, not a 404: "no deal running"
 * is an ordinary state the storefront handles by omitting the section, and a
 * 404 would make it indistinguishable from a broken route.
 */
const getActiveCampaign = catchAsync(async (req: Request, res: Response) => {
    const parsed = activeCampaignQueryZodSchema.safeParse(req.query);

    if (!parsed.success) {
        throw new AppError(
            status.BAD_REQUEST,
            parsed.error.issues[0]?.message ?? "Invalid placement",
        );
    }

    const result = await ProductService.getActiveCampaign(parsed.data.placement);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: result ? "Campaign fetched successfully" : "No active campaign for this placement",
        data: result,
    });
});

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
    getActiveCampaign,
    createCampaign,
    getAdminCampaigns,
    getCampaignById,
    updateCampaign,
    deleteCampaign,
};
