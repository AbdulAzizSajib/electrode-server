import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PurchaseOrderController } from "./purchase-order.controller";
import {
    amendPurchaseOrderZodSchema,
    createPurchaseOrderZodSchema,
    receivePurchaseOrderZodSchema,
    updatePurchaseOrderZodSchema,
} from "./purchase-order.validation";

// Admin/staff-only — inventory endpoints are never reachable by a customer or unauthenticated request.
const router = Router();
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF));

router.post(
    "/",
    validateRequest(createPurchaseOrderZodSchema),
    PurchaseOrderController.createPurchaseOrder,
);
router.get("/", PurchaseOrderController.getPurchaseOrders);
router.get("/:id", PurchaseOrderController.getPurchaseOrderById);
router.patch(
    "/:id",
    validateRequest(updatePurchaseOrderZodSchema),
    PurchaseOrderController.updatePurchaseOrder,
);
/*
 * Separate from PATCH /:id, which owns the scalar fields and refuses any edit
 * once receiving has begun. This one is the opposite shape: it stays available
 * after a partial receipt, because what it may change is precisely what has NOT
 * yet arrived. A permissive PATCH could not express that distinction — see
 * design.md Decision 1.
 */
router.patch(
    "/:id/items",
    validateRequest(amendPurchaseOrderZodSchema),
    PurchaseOrderController.amendPurchaseOrderItems,
);
router.delete("/:id", PurchaseOrderController.deletePurchaseOrder);
router.post(
    "/:id/receive",
    validateRequest(receivePurchaseOrderZodSchema),
    PurchaseOrderController.receivePurchaseOrder,
);

export const PurchaseOrderRoutes = router;
