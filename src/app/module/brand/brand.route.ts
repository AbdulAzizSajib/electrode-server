import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { BrandController } from "./brand.controller";
import { bulkCreateBrandsZodSchema, createBrandZodSchema, updateBrandZodSchema } from "./brand.validation";

const router = Router();

// Admin (any status)
router.get(
    "/admin",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    BrandController.getAdminBrands,
);
router.get(
    "/admin/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    BrandController.getAdminBrandById,
);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(createBrandZodSchema),
    BrandController.createBrand,
);
router.post(
    "/bulk",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(bulkCreateBrandsZodSchema),
    BrandController.bulkCreateBrands,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateBrandZodSchema),
    BrandController.updateBrand,
);
router.delete(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    BrandController.deleteBrand,
);

// Public (ACTIVE-only)
router.get("/", BrandController.getPublicBrands);
router.get("/:slug", BrandController.getPublicBrandBySlug);

export const BrandRoutes = router;
