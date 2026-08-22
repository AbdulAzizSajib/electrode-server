import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PurchaseOrderController } from "./purchase-order.controller";
import {
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
router.delete("/:id", PurchaseOrderController.deletePurchaseOrder);
router.post(
    "/:id/receive",
    validateRequest(receivePurchaseOrderZodSchema),
    PurchaseOrderController.receivePurchaseOrder,
);

export const PurchaseOrderRoutes = router;
