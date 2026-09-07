import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { RefundController } from "./refund.controller";
import { createRefundZodSchema, updateRefundZodSchema } from "./refund.validation";

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

/*
 * Correcting recorded money is held to OWNER/ADMIN — a narrower audience than
 * the STAFF who may issue a refund in the first place. Voiding reverses a
 * payment's status, a return's completion and a product's sold count in one
 * step, which is a larger claim than recording the refund was.
 */
router.patch(
    "/:refundId",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateRefundZodSchema),
    RefundController.updateRefund,
);

// PATCH rather than DELETE: the row is kept and marked CANCELLED, because a
// refund that existed is a thing that happened and the payments report has
// already shown it. Deleting would make the money vanish from history.
router.patch(
    "/:refundId/void",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    RefundController.voidRefund,
);

export const RefundRoutes = router;
