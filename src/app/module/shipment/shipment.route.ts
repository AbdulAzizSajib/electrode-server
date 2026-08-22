import { Router } from "express";
import { ALL_ROLES, RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ShipmentController } from "./shipment.controller";
import { createShipmentZodSchema, updateShipmentZodSchema } from "./shipment.validation";

// Mounted at /orders/:id/shipment — req.params.id is inherited from the parent mount path.
const router = Router({ mergeParams: true });

router.get("/", checkAuth(...ALL_ROLES), ShipmentController.getOrderShipment);
router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    validateRequest(createShipmentZodSchema),
    ShipmentController.createShipment,
);
router.patch(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    validateRequest(updateShipmentZodSchema),
    ShipmentController.updateShipment,
);

export const ShipmentRoutes = router;
