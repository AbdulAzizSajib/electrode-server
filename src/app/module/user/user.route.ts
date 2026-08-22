import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { UserController } from "./user.controller";
import { updateUserZodSchema } from "./user.validation";

const router = Router();

router.get(
    "/",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    UserController.getAllUsers,
);

router.get(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    UserController.getUserById,
);

router.patch(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    validateRequest(updateUserZodSchema),
    UserController.updateUser,
);

router.delete(
    "/:id",
    checkAuth(RoleName.OWNER, RoleName.ADMIN),
    UserController.softDeleteUser,
);

export const UserRoutes = router;
