import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { StoreSettingController } from "./store-setting.controller";
import { updateStoreSettingZodSchema } from "./store-setting.validation";

const router = Router();

router.get("/", checkAuth(RoleName.OWNER, RoleName.ADMIN), StoreSettingController.getStoreSetting);
router.patch(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateStoreSettingZodSchema),
    StoreSettingController.updateStoreSetting,
);

export const StoreSettingRoutes = router;
