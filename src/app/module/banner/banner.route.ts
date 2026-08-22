import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { BannerController } from "./banner.controller";
import { createBannerZodSchema, updateBannerZodSchema } from "./banner.validation";

const router = Router();

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
    validateRequest(createBannerZodSchema),
    BannerController.createBanner,
);
router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateBannerZodSchema),
    BannerController.updateBanner,
);
router.delete("/:id", checkAuth(RoleName.OWNER, RoleName.ADMIN), BannerController.deleteBanner);

// Public (ACTIVE + in-window only)
router.get("/", BannerController.getPublicBanners);

export const BannerRoutes = router;
