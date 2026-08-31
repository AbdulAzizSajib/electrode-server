import { Router } from "express";
import { ADMIN_PANEL_ROLES, ALL_ROLES } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PaymentController } from "./payment.controller";
import { createPaymentZodSchema, updatePaymentStatusZodSchema } from "./payment.validation";

// Mounted at /orders/:id/payments — req.params.id is inherited from the parent mount path.
const router = Router({ mergeParams: true });

router.use(checkAuth(...ALL_ROLES));

router.post("/", validateRequest(createPaymentZodSchema), PaymentController.recordPayment);
router.get("/", PaymentController.getOrderPayments);

// Staff-only, narrower than the router-level guard above: marking a payment
// settled is what credits a product's sales count, so a customer must not be
// able to declare their own COD payment collected. The service re-checks the
// role rather than relying on this line alone.
router.patch(
    "/:paymentId",
    checkAuth(...ADMIN_PANEL_ROLES),
    validateRequest(updatePaymentStatusZodSchema),
    PaymentController.updatePaymentStatus,
);

export const PaymentRoutes = router;
