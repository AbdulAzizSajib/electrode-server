import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { FontService } from "./font.service";

const createFont = catchAsync(async (req: Request, res: Response) => {
    const result = await FontService.createFont(req.user.userId, req.body);

    sendResponse(res, {
        httpStatusCode: status.CREATED,
        success: true,
        message: "Font added successfully",
        data: result,
    });
});

const getFonts = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await FontService.getFonts(req.query as unknown as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Fonts fetched successfully",
        data,
        meta,
    });
});

/**
 * The whole library, unpaginated — what the font pickers render.
 *
 * Separate from the paginated list because a picker showing only page one
 * would hide fonts behind a control that has no next page.
 */
const getAllFonts = catchAsync(async (_req: Request, res: Response) => {
    const result = await FontService.getAllFonts();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Fonts fetched successfully",
        data: result,
    });
});

const getFontById = catchAsync(async (req: Request, res: Response) => {
    const result = await FontService.getFontOrThrow(req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Font fetched successfully",
        data: result,
    });
});

const updateFont = catchAsync(async (req: Request, res: Response) => {
    const result = await FontService.updateFont(
        req.user.userId,
        req.params.id as string,
        req.body,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Font updated successfully",
        data: result,
    });
});

const deleteFont = catchAsync(async (req: Request, res: Response) => {
    const result = await FontService.deleteFont(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Font deleted successfully",
        data: result,
    });
});

export const FontController = {
    createFont,
    getFonts,
    getAllFonts,
    getFontById,
    updateFont,
    deleteFont,
};
