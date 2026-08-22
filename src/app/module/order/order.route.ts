import { Router } from "express";
import { ALL_ROLES, RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { OrderController } from "./order.controller";
import { createOrderZodSchema, updateOrderStatusZodSchema } from "./order.validation";

const router = Router();

router.post(
    "/",
    checkAuth(...ALL_ROLES),
    validateRequest(createOrderZodSchema),
    OrderController.placeOrder,
);
router.get("/", checkAuth(...ALL_ROLES), OrderController.getOrders);
router.get("/:id", checkAuth(...ALL_ROLES), OrderController.getOrderById);
router.patch("/:id/cancel", checkAuth(...ALL_ROLES), OrderController.cancelOrder);
router.patch(
    "/:id/status",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    validateRequest(updateOrderStatusZodSchema),
    OrderController.updateOrderStatus,
);

export const OrderRoutes = router;
