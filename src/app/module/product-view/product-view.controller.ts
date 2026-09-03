import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { isBotUserAgent, viewerKeyFor, ProductViewService } from "./product-view.service";

/**
 * Records a product-page view.
 *
 * Always answers 202 with the same body, whether the view was counted, deduped
 * as a repeat, or dropped as a bot. The caller learns nothing about which —
 * a response that distinguished them would let someone probe whether a given
 * viewer has already seen a product.
 *
 * Nothing here is on the product page's critical path: the storefront fires
 * this and ignores the result, so even an error response leaves the page
 * rendering normally.
 */
const recordProductView = catchAsync(async (req: Request, res: Response) => {
    // Express 5 types a route param as possibly repeated; a single `:id` is
    // always the first (and only) entry.
    const rawId = req.params.id;
    const productId = Array.isArray(rawId) ? rawId[0] : rawId;
    // Express types a header as possibly repeated; only the first matters here.
    const rawUserAgent = req.get("user-agent");
    const userAgent = Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent;

    // Silently ignored rather than rejected — a crawler learns nothing from the
    // response, and the storefront has no use for the distinction either.
    if (!isBotUserAgent(userAgent)) {
        // `req.ip` is the real client: app.ts sets `trust proxy`.
        const viewerKey = viewerKeyFor(req.user?.userId, req.ip, userAgent);
        await ProductViewService.recordView(productId, viewerKey);
    }

    sendResponse(res, {
        httpStatusCode: status.ACCEPTED,
        success: true,
        message: "View recorded",
    });
});

export const ProductViewController = { recordProductView };
