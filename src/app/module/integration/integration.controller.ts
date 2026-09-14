/**
 * HTTP ↔ domain for the integration endpoints.
 *
 * Nothing here decides anything: it unwraps the request, calls the service, and
 * sends the envelope. The one thing worth noticing is what is NOT returned —
 * every response body is a service result that structurally cannot carry a
 * stored secret (see `IIntegrationState`), with the single exception of the
 * webhook generation response, which returns its newly minted secret exactly
 * once because the merchant must paste it into the courier's panel.
 */
import { Request, Response } from "express";
import status from "http-status";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { IntegrationService } from "./integration.service";

const listIntegrations = catchAsync(async (_req: Request, res: Response) => {
    const result = await IntegrationService.listIntegrations();

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Integrations fetched successfully",
        data: result,
    });
});

const getIntegration = catchAsync(async (req: Request, res: Response) => {
    const result = await IntegrationService.getIntegration(req.params.provider as string);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Integration fetched successfully",
        data: result,
    });
});

const updateCredentials = catchAsync(async (req: Request, res: Response) => {
    const result = await IntegrationService.updateCredentials(
        req.user!.userId,
        req.params.provider as string,
        req.body.values,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Credentials saved",
        data: result,
    });
});

/**
 * The one endpoint that returns a secret, and only the one it just created.
 *
 * The merchant has to copy it into the courier's panel, so there is no way to
 * avoid showing it. Showing it once on the response to an explicit generate
 * action is a far narrower surface than storing it somewhere a later read could
 * return.
 */
const generateWebhookSecret = catchAsync(async (req: Request, res: Response) => {
    const result = await IntegrationService.generateWebhookSecret(
        req.user!.userId,
        req.params.provider as string,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: "Webhook secret generated. Copy it now — it cannot be shown again.",
        data: result,
    });
});

const setEnabled = catchAsync(async (req: Request, res: Response) => {
    const result = await IntegrationService.setEnabled(
        req.user!.userId,
        req.params.provider as string,
        req.body.enabled,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: req.body.enabled ? "Integration enabled" : "Integration disabled",
        data: result,
    });
});

export const IntegrationController = {
    listIntegrations,
    getIntegration,
    updateCredentials,
    generateWebhookSecret,
    setEnabled,
};
