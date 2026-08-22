import { Router } from "express";
import { ALL_ROLES, RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ReturnController } from "./return.controller";
import { createReturnZodSchema, updateReturnStatusZodSchema } from "./return.validation";

// Mounted at /orders/:id/returns — req.params.id (the order id) is inherited from the parent mount path.
const nestedRouter = Router({ mergeParams: true });
nestedRouter.post(
    "/",
    checkAuth(...ALL_ROLES),
    validateRequest(createReturnZodSchema),
    ReturnController.createReturn,
);
export const ReturnNestedRoutes = nestedRouter;

// Mounted at /returns
const router = Router();
router.get("/", checkAuth(...ALL_ROLES), ReturnController.getReturns);
router.get("/:id", checkAuth(...ALL_ROLES), ReturnController.getReturnById);
router.patch(
    "/:id/status",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    validateRequest(updateReturnStatusZodSchema),
    ReturnController.updateReturnStatus,
);
export const ReturnRoutes = router;
