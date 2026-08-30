import { Router } from "express";
import { multerUpload } from "../../config/multer.config";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { BannerController } from "./banner.controller";
import { createBannerZodSchema, updateBannerZodSchema } from "./banner.validation";

const router = Router();

/**
 * Banner artwork is uploaded directly (multipart), not passed as a pre-hosted URL.
 * Two distinct single-file fields, so `.fields()` rather than `.array()`; the
 * non-file payload rides along as a `data` JSON field, which `validateRequest`
 * already unwraps. A plain application/json request with URL strings still works.
 */
const bannerImageUpload = multerUpload.fields([
    { name: "image", maxCount: 1 },
    { name: "mobileImage", maxCount: 1 },
]);

// Admin (any status)
router.get("/admin", checkAuth(RoleName.OWNER, RoleName.ADMIN), BannerController.getAdminBanners);
router.get(
    "/admin/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    BannerController.getBannerById,
);

router.post(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    bannerImageUpload,
    BannerController.mergeUploadedBannerImages,
    validateRequest(createBannerZodSchema),
    BannerController.createBanner,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    bannerImageUpload,
    BannerController.mergeUploadedBannerImages,
    validateRequest(updateBannerZodSchema),
    BannerController.updateBanner,
);
router.delete("/:id", checkAuth(RoleName.OWNER, RoleName.ADMIN), BannerController.deleteBanner);

// Public (ACTIVE + in-window only)
router.get("/", BannerController.getPublicBanners);

export const BannerRoutes = router;
