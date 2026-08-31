import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { multerUpload } from "../../config/multer.config";
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
    multerUpload.array("images", 10),
    validateRequest(createProductZodSchema),
    ProductController.createProduct,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    multerUpload.array("images", 10),
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
// MUST stay above "/:slug": Express matches in declaration order, so declaring
// this later would let the parameterised route capture the literal path
// "search" and 404 as though a product with that slug were missing.
router.get("/search", ProductController.searchProducts);
// Two segments, so it cannot be shadowed by the single-segment "/:slug" below.
router.get("/:slug/related", ProductController.getRelatedProducts);
router.get("/:slug", ProductController.getPublicProductBySlug);

export const ProductRoutes = router;
