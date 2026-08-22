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
const cartRouter = Router();
cartRouter.use(optionalAuth);
cartRouter.post("/apply-coupon", validateRequest(applyCouponZodSchema), CouponController.applyCoupon);
cartRouter.delete("/coupon", CouponController.removeCoupon);
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
