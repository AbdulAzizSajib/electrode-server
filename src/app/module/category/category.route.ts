import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CategoryController } from "./category.controller";
import { createCategoryZodSchema, updateCategoryZodSchema } from "./category.validation";

const router = Router();

// Admin (any status, flat listing/single-by-id for edit forms)
router.get(
    "/admin",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    CategoryController.getAdminCategories,
);
router.get(
    "/admin/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    CategoryController.getAdminCategoryById,
);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(createCategoryZodSchema),
    CategoryController.createCategory,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateCategoryZodSchema),
    CategoryController.updateCategory,
);
router.delete(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    CategoryController.deleteCategory,
);

// Public (ACTIVE-only)
router.get("/", CategoryController.getPublicCategoryTree);
router.get("/:slug", CategoryController.getPublicCategoryBySlug);

export const CategoryRoutes = router;
