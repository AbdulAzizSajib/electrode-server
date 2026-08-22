import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { RefundController } from "./refund.controller";
import { createRefundZodSchema } from "./refund.validation";

// Mounted at /orders/:id/refunds — req.params.id (the order id) is inherited from the parent mount path.
const nestedRouter = Router({ mergeParams: true });
nestedRouter.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    validateRequest(createRefundZodSchema),
    RefundController.createRefund,
);
export const RefundNestedRoutes = nestedRouter;

// Mounted at /refunds - admin/financial view, no customer self-service (per tasks.md's plain "GET /refunds").
const router = Router();
router.get("/", checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF), RefundController.getRefunds);
export const RefundRoutes = router;
