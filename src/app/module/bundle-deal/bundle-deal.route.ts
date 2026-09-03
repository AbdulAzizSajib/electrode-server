import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { BundleDealController } from "./bundle-deal.controller";
import {
    createBundleDealZodSchema,
    updateBundleDealZodSchema,
} from "./bundle-deal.validation";

const router = Router();

router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN));

// Above `/:id`, or the literal segment would be captured as an id.
router.get("/all", BundleDealController.getAllBundleDeals);

router.get("/", BundleDealController.getBundleDeals);
router.get("/:id", BundleDealController.getBundleDealById);

router.post("/", validateRequest(createBundleDealZodSchema), BundleDealController.createBundleDeal);
router.patch(
    "/:id",
    validateRequest(updateBundleDealZodSchema),
    BundleDealController.updateBundleDeal,
);
router.delete("/:id", BundleDealController.deleteBundleDeal);

export const BundleDealRoutes = router;
