import { Router } from "express";
import { ADMIN_PANEL_ROLES, ALL_ROLES, RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { optionalAuth } from "../../middleware/optionalAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { OrderController } from "./order.controller";
import {
    createManualOrderZodSchema,
    createOrderZodSchema,
    guestOrderLookupZodSchema,
    quoteCheckoutZodSchema,
    quoteManualOrderZodSchema,
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

// Pricing without ordering. Same optional session as checkout — a guest needs
// the quote most, since they have no saved address to have been quoted against
// before. Declared before "/:id" so that path never captures the literal.
router.post(
    "/quote",
    optionalAuth,
    validateRequest(quoteCheckoutZodSchema),
    OrderController.quoteCheckout,
);

// Guest order tracking. Declared before "/:id" so that path never swallows it,
// and POST so the phone — half the credential — stays out of URLs and logs.
router.post(
    "/track",
    validateRequest(guestOrderLookupZodSchema),
    OrderController.getGuestOrder,
);

/*
 * Staff recording an order a customer placed off-site — over WhatsApp,
 * Messenger, a phone call or at the counter.
 *
 * A separate route rather than a branch inside "/" above, and the guard is the
 * reason: "/" runs under `optionalAuth` because it must serve guests, which is
 * the one path that has to work with no account at all. A staff branch inside
 * it would mean one validation schema describing both a shopper's checkout and
 * an operator's order entry — each carrying fields the other must be unable to
 * send — with the role check buried in the service instead of stated here.
 * Two routes is what keeps `discountAmount` unspellable at checkout.
 *
 * Both are declared above the "/:id" group below, matching the convention the
 * literals at the top of this file follow, even though no POST "/:id" exists
 * today to capture them.
 */
router.post(
    "/manual",
    checkAuth(...ADMIN_PANEL_ROLES),
    validateRequest(createManualOrderZodSchema),
    OrderController.placeManualOrder,
);

// Pricing for an order still being typed, so the operator can read the total
// back to the customer before committing. Staff-only for the same reason the
// placement above is: `discountAmount` is reachable here and nowhere else.
router.post(
    "/quote/manual",
    checkAuth(...ADMIN_PANEL_ROLES),
    validateRequest(quoteManualOrderZodSchema),
    OrderController.quoteManualOrder,
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
