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
 * The machine-to-machine routes are declared first, purely for readability —
 * every other path in this router is a literal segment, so unlike /orders or
 * /products there is no ordering constraint between them. None can use
 * `checkAuth`: a courier and Vercel Cron have no session. See courier.guard.ts.
 */

/**
 * A courier pushes its delivery-status and tracking notifications here.
 *
 * One endpoint per provider, each authenticating that provider's own token. A
 * single shared endpoint would have to identify the sender before it could
 * authenticate it — trying every configured token in turn — which means a token
 * leaked for one courier would grant access to every courier's notifications.
 *
 * See openspec/changes/add-courier-provider-selection, design.md Decision 5.
 */
router.post(
    "/webhook/:provider",
    requireWebhookToken,
    validateRequest(courierWebhookZodSchema),
    CourierController.handleWebhook,
);

/**
 * The pre-provider path, kept as a Steadfast alias.
 *
 * This URL is already registered in Steadfast's portal for existing
 * deployments. Re-registering is a manual step in someone else's UI, and a
 * webhook posted to a 404 is dropped with no record that it was ever sent — so
 * the old path keeps working rather than being cleaned up.
 */
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

/**
 * Which provider is configured, what each can do, and whether each is usable.
 *
 * Separate from `/balance`, which is a live call to the courier. This is derived
 * state about the environment and the registry — it makes no outbound request,
 * so the admin can read it on every page load. It reports only WHETHER each
 * credential is present, never its value.
 */
router.get("/config", checkAuth(...STAFF_ROLES), CourierController.getProviderConfiguration);

router.get("/balance", checkAuth(...STAFF_ROLES), CourierController.getBalance);

router.post(
    "/orders/:id/return",
    checkAuth(...STAFF_ROLES),
    validateRequest(courierReturnZodSchema),
    CourierController.createReturnRequest,
);

export const CourierRoutes = router;
