import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { StorageController } from "./storage.controller";

/*
 * OWNER/ADMIN only, and read-only.
 *
 * Not because the figures are secret, but because each request makes a live
 * call to Cloudinary's Admin API, which is rate-limited (500/hour on the free
 * tier). An unauthenticated or storefront-reachable version of this would spend
 * that budget on traffic that has no use for the answer.
 */
const router = Router();
router.get("/", checkAuth(RoleName.OWNER, RoleName.ADMIN), StorageController.getStorageUsage);

export const StorageRoutes = router;
