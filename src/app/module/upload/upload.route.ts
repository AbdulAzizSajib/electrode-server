import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { multerUpload } from "../../config/multer.config";
import { checkAuth } from "../../middleware/checkAuth";
import { UploadController } from "./upload.controller";

// Admin/staff-only — backs the catalog/marketing admin UIs (Category/Product/Banner
// image fields), which otherwise only accept an already-hosted URL string.
const router = Router();

router.post(
    "/image",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    multerUpload.single("file"),
    UploadController.uploadImage,
);

// Video and poster frame arrive together: a video without a thumbnail shows a
// black rectangle until it plays, so they are only useful as a pair.
router.post(
    "/video",
    checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF),
    multerUpload.fields([
        { name: "video", maxCount: 1 },
        { name: "thumbnail", maxCount: 1 },
    ]),
    UploadController.uploadVideo,
);

export const UploadRoutes = router;
