import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CourierController } from "./courier.controller";
import { requireSyncSecret, requireWebhookToken } from "./courier.guard";
import {
    courierReturnZodSchema,
    courierWebhookZodSchema,
    dispatchOrdersZodSchema,
    previewDispatchZodSchema,
} from "./courier.validation";

const router = Router();

const STAFF_ROLES = [RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF] as const;

/*
 * The two machine-to-machine routes are declared first, purely for readability —
 * every path in this router is a literal segment, so unlike /orders or /products
 * there is no ordering constraint here at all. Neither can use `checkAuth`:
 * Steadfast and Vercel Cron have no session. See courier.guard.ts.
 */

/** Steadfast pushes delivery-status and tracking notifications here. */
router.post(
    "/webhook",
    requireWebhookToken,
    validateRequest(courierWebhookZodSchema),
    CourierController.handleWebhook,
);

/** Vercel Cron calls this to catch consignments whose webhook was missed. */
router.post("/sync", requireSyncSecret, CourierController.runReconciliation);

/** What would and would not go, before anything is sent. */
router.post(
    "/dispatch/preview",
    checkAuth(...STAFF_ROLES),
    validateRequest(previewDispatchZodSchema),
    CourierController.previewDispatch,
);

router.post(
    "/dispatch",
    checkAuth(...STAFF_ROLES),
    validateRequest(dispatchOrdersZodSchema),
    CourierController.dispatchOrders,
);

router.get("/balance", checkAuth(...STAFF_ROLES), CourierController.getBalance);

router.post(
    "/orders/:id/return",
    checkAuth(...STAFF_ROLES),
    validateRequest(courierReturnZodSchema),
    CourierController.createReturnRequest,
);

export const CourierRoutes = router;
