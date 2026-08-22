import { Router } from "express";
import { ALL_ROLES } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PaymentController } from "./payment.controller";
import { createPaymentZodSchema } from "./payment.validation";

// Mounted at /orders/:id/payments — req.params.id is inherited from the parent mount path.
const router = Router({ mergeParams: true });

router.use(checkAuth(...ALL_ROLES));

router.post("/", validateRequest(createPaymentZodSchema), PaymentController.recordPayment);
router.get("/", PaymentController.getOrderPayments);

export const PaymentRoutes = router;
