import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { optionalAuth } from "../../middleware/optionalAuth";
import { validateQuery } from "../../middleware/validateQuery";
import { validateRequest } from "../../middleware/validateRequest";
import { AbandonedCartController, CartController } from "./cart.controller";
import {
    abandonedCartsQueryZodSchema,
    addCartItemZodSchema,
    deleteCartsZodSchema,
    purgeCartsZodSchema,
    updateCartItemZodSchema,
} from "./cart.validation";

const router = Router();

// Every route works for both guests (guestToken cookie) and logged-in
// customers (session) on the same path — see optionalAuth + cart.service.ts.
router.use(optionalAuth);

router.get("/", CartController.getCart);
router.post("/items", validateRequest(addCartItemZodSchema), CartController.addItem);
router.patch(
    "/items/:itemId",
    validateRequest(updateCartItemZodSchema),
    CartController.updateItemQuantity,
);
router.delete("/items/:itemId", CartController.removeItem);

export const CartRoutes = router;

/*
 * The admin's abandoned-cart endpoints. A SEPARATE router because the one above
 * applies `optionalAuth` to everything it mounts, and these are admin routes.
 * Every role may read; only OWNER and ADMIN may delete, enforced here rather
 * than in the service. See openspec/changes/add-abandoned-carts-admin,
 * design.md Decision 4.
 */
const abandonedRouter = Router();

abandonedRouter.get(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    validateQuery(abandonedCartsQueryZodSchema),
    AbandonedCartController.getAbandonedCarts,
);
abandonedRouter.get(
    "/summary",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    AbandonedCartController.getAbandonedCartSummary,
);
abandonedRouter.delete(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(deleteCartsZodSchema),
    AbandonedCartController.deleteCarts,
);
abandonedRouter.post(
    "/purge",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(purgeCartsZodSchema),
    AbandonedCartController.purgeCarts,
);

export const AbandonedCartRoutes = abandonedRouter;
