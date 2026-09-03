import { Request, Response } from "express";
import status from "http-status";
import { IQueryParams } from "../../interfaces/query.interface";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { TagService } from "./tag.service";

/**
 * Backs the product form's tag autocomplete.
 *
 * A blank term returns nothing rather than every tag: the field suggests as the
 * merchant types, and an empty query is the state before they have.
 */
const searchTags = catchAsync(async (req: Request, res: Response) => {
    const term = req.query.q;
    const result = await TagService.searchTags(typeof term === "string" ? term : "");

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Tags fetched successfully",
        data: result,
    });
});

const getTags = catchAsync(async (req: Request, res: Response) => {
    const { data, meta } = await TagService.getTags(req.query as unknown as IQueryParams);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Tags fetched successfully",
        data,
        meta,
    });
});

const deleteTag = catchAsync(async (req: Request, res: Response) => {
    const result = await TagService.deleteTag(req.user.userId, req.params.id as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message:
            result.untaggedProducts > 0
                ? `Tag deleted. Removed from ${result.untaggedProducts} product(s).`
                : "Tag deleted successfully",
        data: result.tag,
    });
});

export const TagController = { searchTags, getTags, deleteTag };
