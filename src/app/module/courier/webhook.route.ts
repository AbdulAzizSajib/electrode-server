/**
 * The per-integration webhook callback URL: `/webhooks/:provider/:publicId`.
 *
 * A SECOND DOOR INTO ONE IMPLEMENTATION, not a second implementation. The
 * handler and the authentication are the same ones `/courier/webhook/:provider`
 * uses; `resolveWebhookByPublicId` only attributes the request before handing
 * over to `requireWebhookToken`. Keeping it that way is the point — two URLs
 * that authenticate differently would eventually mean one of them
 * authenticating worse.
 *
 * WHY THE PUBLIC ID AT ALL, given that the bearer token is the real boundary:
 * the path is not enumerable, and a notification can be attributed to an
 * integration before any token comparison happens. It is an identifier, not a
 * secret, and nothing here treats it as one.
 *
 * WHY THIS IS MOUNTED SEPARATELY from `/courier`: a courier's own panel sends
 * here, and this path says what it is — a webhook endpoint for an integration —
 * rather than burying it under an admin-facing resource. The legacy
 * `/courier/webhook` paths keep working regardless; a webhook that silently
 * stops arriving is invisible until parcels appear stuck.
 *
 * See openspec/changes/rename-courier-setting-to-integrations, design.md
 * Decision 6.
 */
import { Router } from "express";
import { validateRequest } from "../../middleware/validateRequest";
import { CourierController } from "./courier.controller";
import { resolveWebhookByPublicId } from "./courier.guard";
import { courierWebhookZodSchema } from "./courier.validation";

const router = Router();

router.post(
    "/:provider/:publicId",
    resolveWebhookByPublicId,
    validateRequest(courierWebhookZodSchema),
    CourierController.handleWebhook,
);

export const WebhookRoutes = router;
