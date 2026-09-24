import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { PromoBannerGroupService } from "./promo-banner-group.service";

const createPromoBannerGroup = catchAsync(async (req: Request, res: Response) => {
    const result = await PromoBannerGroupService.createPromoBannerGroup(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Promo banner group created successfully",
        data: result,
    });
});

/**
 * Public and unpaginated.
 *
 * A store has a handful of promo strips, not a catalog of them, and the
 * storefront needs every one of them to render the homepage — so paginating
 * would mean the homepage requesting page two to finish drawing itself.
 */
const getPromoBannerGroups = catchAsync(async (_req: Request, res: Response) => {
    const result = await PromoBannerGroupService.listPromoBannerGroups();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Promo banner groups fetched successfully",
        data: result,
    });
});

const getPromoBannerGroupById = catchAsync(async (req: Request, res: Response) => {
    const result = await PromoBannerGroupService.getPromoBannerGroupById(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Promo banner group fetched successfully",
        data: result,
    });
});

const updatePromoBannerGroup = catchAsync(async (req: Request, res: Response) => {
    const result = await PromoBannerGroupService.updatePromoBannerGroup(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Promo banner group updated successfully",
        data: result,
    });
});

const reorderPromoBannerGroups = catchAsync(async (req: Request, res: Response) => {
    const result = await PromoBannerGroupService.reorderPromoBannerGroups(
        req.user.userId,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Promo banner groups reordered successfully",
        data: result,
    });
});

const deletePromoBannerGroup = catchAsync(async (req: Request, res: Response) => {
    const result = await PromoBannerGroupService.deletePromoBannerGroup(
        req.user.userId,
        req.params.id as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Promo banner group deleted successfully. Its banners were kept and unassigned.",
        data: result,
    });
});

export const PromoBannerGroupController = {
    createPromoBannerGroup,
    getPromoBannerGroups,
    getPromoBannerGroupById,
    updatePromoBannerGroup,
    reorderPromoBannerGroups,
    deletePromoBannerGroup,
};
