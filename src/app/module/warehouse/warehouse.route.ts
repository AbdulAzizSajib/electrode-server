import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { WarehouseController } from "./warehouse.controller";
import { createWarehouseZodSchema, updateWarehouseZodSchema } from "./warehouse.validation";

// Admin/staff-only — inventory endpoints are never reachable by a customer or unauthenticated request.
const router = Router();
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF));

router.post("/", validateRequest(createWarehouseZodSchema), WarehouseController.createWarehouse);
router.get("/", WarehouseController.getWarehouses);
router.get("/:id", WarehouseController.getWarehouseById);
router.patch("/:id", validateRequest(updateWarehouseZodSchema), WarehouseController.updateWarehouse);
router.delete("/:id", WarehouseController.deleteWarehouse);

export const WarehouseRoutes = router;
