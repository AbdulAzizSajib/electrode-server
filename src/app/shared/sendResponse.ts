import { Response } from "express";

interface IResponseData<T> {
    httpStatusCode: number;
    success: boolean;
    message: string;
    data?: T;
    meta ?: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        /**
         * Rating summary for a product's public review listing. Additive and
         * optional — every existing paginated response is unaffected.
         */
        ratingBreakdown?: {
            average: number;
            total: number;
            counts: Record<number, number>;
        };
        /**
         * How many of a content list the storefront's homepage section actually
         * renders, for admin lists that need to mark the published entries
         * falling beyond it. Served rather than duplicated in the admin so the
         * label cannot promise a number nothing enforces — the same reason
         * `GET /pages/reserved-slugs` exists. Additive and optional.
         */
        homeSectionCount?: number;
    }
}


export const sendResponse = <T>(res: Response, responseData: IResponseData<T>) => {
    const { httpStatusCode, success, message, data, meta } = responseData;

    res.status(httpStatusCode).json({
        success,
        message,
        data,
        meta
    });
}