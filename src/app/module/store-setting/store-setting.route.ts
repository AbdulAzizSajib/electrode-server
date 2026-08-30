import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { StoreSettingController } from "./store-setting.controller";
import { updateStoreSettingZodSchema } from "./store-setting.validation";

const router = Router();

// Public storefront projection — no auth. Registered before "/" so the literal
// segment is matched first. Read-only by construction: the service uses
// findUnique, never the upsert the admin read relies on.
router.get("/public", StoreSettingController.getPublicStoreSetting);

router.get("/", checkAuth(RoleName.OWNER, RoleName.ADMIN), StoreSettingController.getStoreSetting);
router.patch(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateStoreSettingZodSchema),
    StoreSettingController.updateStoreSetting,
);

export const StoreSettingRoutes = router;
