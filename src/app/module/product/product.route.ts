import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ProductController } from "./product.controller";
import { createProductZodSchema, updateProductZodSchema } from "./product.validation";

const router = Router();

// Admin (any status)
router.get(
    "/admin",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    ProductController.getAdminProducts,
);
router.get(
    "/admin/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    ProductController.getAdminProductById,
);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(createProductZodSchema),
    ProductController.createProduct,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateProductZodSchema),
    ProductController.updateProduct,
);
router.delete(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    ProductController.deleteProduct,
);

// Supplementary category tagging (additive to the product's primary category)
router.post(
    "/:id/categories/:categoryId",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    ProductController.addProductCategory,
);
router.delete(
    "/:id/categories/:categoryId",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    ProductController.removeProductCategory,
);

// Public (ACTIVE-only)
router.get("/", ProductController.getPublicProducts);
router.get("/:slug", ProductController.getPublicProductBySlug);

export const ProductRoutes = router;
