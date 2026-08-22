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

export const UploadRoutes = router;
