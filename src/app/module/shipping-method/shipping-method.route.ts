import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ShippingMethodController } from "./shipping-method.controller";
import {
    createShippingMethodZodSchema,
    updateShippingMethodZodSchema,
} from "./shipping-method.validation";

const router = Router();

router.get(
    "/admin",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    ShippingMethodController.getAdminShippingMethods,
);
router.get(
    "/admin/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    ShippingMethodController.getAdminShippingMethodById,
);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(createShippingMethodZodSchema),
    ShippingMethodController.createShippingMethod,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateShippingMethodZodSchema),
    ShippingMethodController.updateShippingMethod,
);
router.delete(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    ShippingMethodController.deleteShippingMethod,
);

// Public (active only)
router.get("/", ShippingMethodController.getPublicShippingMethods);

export const ShippingMethodRoutes = router;
