import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { RoleController } from "./role.controller";
import {
    assignPermissionZodSchema,
    createPermissionZodSchema,
    createRoleZodSchema,
    updatePermissionZodSchema,
    updateRoleZodSchema,
} from "./role.validation";

// Creating/editing Role, Permission, or RolePermission is OWNER-only — not
// ADMIN or STAFF, since this controls the privilege system itself (per
// api/support-and-admin spec).
const router = Router();
router.use(checkAuth(RoleName.OWNER));

router.post("/", validateRequest(createRoleZodSchema), RoleController.createRole);
router.get("/", RoleController.getRoles);
router.get("/:id", RoleController.getRoleById);
router.patch("/:id", validateRequest(updateRoleZodSchema), RoleController.updateRole);
router.delete("/:id", RoleController.deleteRole);

router.post(
    "/:id/permissions",
    validateRequest(assignPermissionZodSchema),
    RoleController.assignPermissionToRole,
);
router.delete("/:id/permissions/:permissionId", RoleController.revokePermissionFromRole);

export const RoleRoutes = router;

const permissionRouter = Router();
permissionRouter.use(checkAuth(RoleName.OWNER));

permissionRouter.post(
    "/",
    validateRequest(createPermissionZodSchema),
    RoleController.createPermission,
);
permissionRouter.get("/", RoleController.getPermissions);
permissionRouter.get("/:id", RoleController.getPermissionById);
permissionRouter.patch(
    "/:id",
    validateRequest(updatePermissionZodSchema),
    RoleController.updatePermission,
);
permissionRouter.delete("/:id", RoleController.deletePermission);

export const PermissionRoutes = permissionRouter;
