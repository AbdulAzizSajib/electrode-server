import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { SEO_CONTENT_TYPES, SeoContentType } from "../store-setting/store-setting.constant";
import { SeoService } from "./seo.service";

const getSeoOverview = catchAsync(async (req: Request, res: Response) => {
    // Narrowed against the closed content-type list rather than passed through:
    // an unrecognised value would otherwise filter every row out and read as
    // "this shop has no content" instead of "that is not a content type".
    const raw = req.query.contentType;
    const contentType = SEO_CONTENT_TYPES.includes(raw as SeoContentType)
        ? (raw as SeoContentType)
        : undefined;

    const { data, meta } = await SeoService.getSeoOverview({
        contentType,
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        page: Number(req.query.page) || undefined,
        limit: Number(req.query.limit) || undefined,
    });

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "SEO overview fetched successfully",
        data,
        meta,
    });
});

const getSitemapEntries = catchAsync(async (_req: Request, res: Response) => {
    const result = await SeoService.getSitemapEntries();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Sitemap entries fetched successfully",
        data: result,
    });
});

export const SeoController = {
    getSeoOverview,
    getSitemapEntries,
};
