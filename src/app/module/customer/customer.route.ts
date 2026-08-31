import { Router } from "express";
import { ALL_ROLES, RoleName } from "../../constants/role.constant";
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

/**
 * Mounted at /customers — the admin customer directory, OWNER/ADMIN only.
 *
 * MUST be mounted AFTER CustomerAddressRoutes ("/customers/me/addresses") in
 * routes/index.ts: Express matches in declaration order, so mounting this first
 * would let "/:id" capture the literal "me" segment and 404 every self-service
 * address request — the same hazard documented in product.route.ts.
 */
const adminRouter = Router();

adminRouter.use(checkAuth(RoleName.OWNER, RoleName.ADMIN));

adminRouter.get("/", CustomerController.getCustomers);
adminRouter.get("/:id", CustomerController.getCustomerById);

export const CustomerRoutes = adminRouter;
