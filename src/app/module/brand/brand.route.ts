import { Router } from "express";
import { multerUpload } from "../../config/multer.config";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { BrandController } from "./brand.controller";
import { bulkCreateBrandsZodSchema, createBrandZodSchema, updateBrandZodSchema } from "./brand.validation";

const router = Router();

// Brand logo is uploaded directly (multipart) rather than passed as a pre-hosted
// URL. A plain application/json request with a `logo` URL string still works.
const brandLogoUpload = multerUpload.single("logo");

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
    brandLogoUpload,
    BrandController.mergeUploadedBrandLogo,
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
    brandLogoUpload,
    BrandController.mergeUploadedBrandLogo,
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
