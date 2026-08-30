import { Router } from "express";
import { multerUpload } from "../../config/multer.config";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CategoryController } from "./category.controller";
import { createCategoryZodSchema, updateCategoryZodSchema } from "./category.validation";

const router = Router();

// Category artwork (image + optional banner) is uploaded directly (multipart),
// not passed as pre-hosted URLs. A plain application/json request with URL
// strings still works.
const categoryImageUpload = multerUpload.fields([
    { name: "image", maxCount: 1 },
    { name: "banner", maxCount: 1 },
]);

// Admin (any status, flat listing/single-by-id for edit forms)
router.get(
    "/admin",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    CategoryController.getAdminCategories,
);
router.get(
    "/admin/tree",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    CategoryController.getAdminCategoryTree,
);
router.get(
    "/admin/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    CategoryController.getAdminCategoryById,
);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    categoryImageUpload,
    CategoryController.mergeUploadedCategoryImages,
    validateRequest(createCategoryZodSchema),
    CategoryController.createCategory,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    categoryImageUpload,
    CategoryController.mergeUploadedCategoryImages,
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
