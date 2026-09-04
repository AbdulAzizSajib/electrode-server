import { Request, Response } from "express";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { RESERVED_SLUGS } from "./page.constant";
import { PageService } from "./page.service";

const createPage = catchAsync(async (req: Request, res: Response) => {
    const result = await PageService.createPage(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Page created successfully",
        data: result,
    });
});

const getAdminPages = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await PageService.getAdminPages(
        req.query as unknown as IQueryParams,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Pages fetched successfully",
        data,
        meta,
    });
});

const getPageById = catchAsync(async (req: Request, res: Response) => {
    const result = await PageService.getPageOrThrow(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Page fetched successfully",
        data: result,
    });
});

/**
 * Served to the admin panel so its slug field can flag a reserved slug as the
 * merchant types, instead of waiting for the save to 409. The list is the
 * server's — see page.constant.ts on why admin must not keep its own copy.
 */
const getReservedSlugs = catchAsync(async (_req: Request, res: Response) => {
    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Reserved slugs fetched successfully",
        data: RESERVED_SLUGS,
    });
});

const updatePage = catchAsync(async (req: Request, res: Response) => {
    const result = await PageService.updatePage(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Page updated successfully",
        data: result,
    });
});

const deletePage = catchAsync(async (req: Request, res: Response) => {
    const result = await PageService.deletePage(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Page deleted successfully",
        data: result,
    });
});

/** Public: published pages only, trimmed to what a link picker renders. */
const getPublicPages = catchAsync(async (_req: Request, res: Response) => {
    const result = await PageService.getPublishedPageSummaries();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Pages fetched successfully",
        data: result,
    });
});

const getPublicPageBySlug = catchAsync(async (req: Request, res: Response) => {
    const result = await PageService.getPublishedPageBySlug(req.params.slug as string);

    // A DRAFT and a non-existent slug both land here, deliberately: the
    // response must not let a visitor distinguish an unpublished page from
    // one that was never written.
    if (!result) {
        throw new AppError(status.NOT_FOUND, "Page not found");
    }

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Page fetched successfully",
        data: result,
    });
});

export const PageController = {
    createPage,
    getAdminPages,
    getPageById,
    getReservedSlugs,
    updatePage,
    deletePage,
    getPublicPages,
    getPublicPageBySlug,
};
