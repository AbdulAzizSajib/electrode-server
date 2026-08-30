import { Router } from "express";
import { ALL_ROLES, RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { optionalAuth } from "../../middleware/optionalAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { OrderController } from "./order.controller";
import {
    createOrderZodSchema,
    guestOrderLookupZodSchema,
    updateOrderStatusZodSchema,
} from "./order.validation";

const router = Router();

// Checkout serves guests and logged-in customers on the same path, mirroring
// the cart routes: `optionalAuth` resolves a session when there is one and
// falls through to guest handling when there is not, rather than rejecting.
// Every other route below stays session-only.
router.post(
    "/",
    optionalAuth,
    validateRequest(createOrderZodSchema),
    OrderController.placeOrder,
);

// Guest order tracking. Declared before "/:id" so that path never swallows it,
// and POST so the phone — half the credential — stays out of URLs and logs.
router.post(
    "/track",
    validateRequest(guestOrderLookupZodSchema),
    OrderController.getGuestOrder,
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
