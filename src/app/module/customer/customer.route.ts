import { Router } from "express";
import { ALL_ROLES } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CustomerController } from "./customer.controller";
import { createAddressZodSchema, updateAddressZodSchema } from "./customer.validation";

const router = Router();

// All routes are self-service ("me") - scoped to the requesting customer only.
router.use(checkAuth(...ALL_ROLES));

router.get("/", CustomerController.getMyAddresses);
router.post("/", validateRequest(createAddressZodSchema), CustomerController.createAddress);
router.get("/:id", CustomerController.getMyAddressById);
router.patch("/:id", validateRequest(updateAddressZodSchema), CustomerController.updateAddress);
router.patch("/:id/set-default", CustomerController.setDefaultAddress);
router.delete("/:id", CustomerController.deleteAddress);

export const CustomerAddressRoutes = router;
