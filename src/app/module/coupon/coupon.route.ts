import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { optionalAuth } from "../../middleware/optionalAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CouponController } from "./coupon.controller";
import {
    applyCouponZodSchema,
    createCouponZodSchema,
    updateCouponZodSchema,
} from "./coupon.validation";

// Mounted at /cart, alongside cart.route.ts's own router (see routes/index.ts) —
// works for both guests and logged-in customers, same as the rest of /cart.
//
// `optionalAuth` is attached PER ROUTE, not with `cartRouter.use`. This router
// is mounted at the same `/cart` prefix as the cart router and is entered first,
// so a router-level `use` ran for EVERY cart request — GET /cart, add, update,
// remove — before falling through to the cart router, which resolves the
// session again. That was three extra database round trips on each of them.
const cartRouter = Router();
cartRouter.post(
    "/apply-coupon",
    optionalAuth,
    validateRequest(applyCouponZodSchema),
    CouponController.applyCoupon,
);
cartRouter.delete("/coupon", optionalAuth, CouponController.removeCoupon);
export const CartCouponRoutes = cartRouter;

// Mounted at /coupons — admin-only management.
const router = Router();
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN));

router.post("/", validateRequest(createCouponZodSchema), CouponController.createCoupon);
router.get("/", CouponController.getAdminCoupons);
router.get("/:id", CouponController.getCouponById);
router.patch("/:id", validateRequest(updateCouponZodSchema), CouponController.updateCoupon);
router.delete("/:id", CouponController.deleteCoupon);

export const CouponRoutes = router;
