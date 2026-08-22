import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { SupplierController } from "./supplier.controller";
import { createSupplierZodSchema, updateSupplierZodSchema } from "./supplier.validation";

// Admin/staff-only — inventory endpoints are never reachable by a customer or unauthenticated request.
const router = Router();
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF));

router.post("/", validateRequest(createSupplierZodSchema), SupplierController.createSupplier);
router.get("/", SupplierController.getSuppliers);
router.get("/:id", SupplierController.getSupplierById);
router.patch("/:id", validateRequest(updateSupplierZodSchema), SupplierController.updateSupplier);
router.delete("/:id", SupplierController.deleteSupplier);

export const SupplierRoutes = router;
