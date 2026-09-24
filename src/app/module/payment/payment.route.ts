import { Router } from "express";
import { ADMIN_PANEL_ROLES, ALL_ROLES } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PaymentController } from "./payment.controller";
import {
    createPaymentZodSchema,
    rejectPaymentZodSchema,
    updatePaymentStatusZodSchema,
} from "./payment.validation";

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

/*
 * VERIFYING AND REJECTING AN ADVANCE PAYMENT CLAIM.
 *
 * Staff-only on the route AND re-checked in the service, like the PATCH above
 * and for a sharper version of the same reason: this is the decision that
 * releases an order to ship. A customer able to reach it could verify their own
 * claim and defeat the feature entirely.
 *
 * Two named routes rather than one PATCH taking a status, because "verify" and
 * "reject" are decisions with different obligations — a rejection must carry a
 * reason — and spelling them as a status write loses that distinction along
 * with the verifier's identity. See
 * openspec/changes/add-advance-payment-checkout, design.md Decision 6.
 */
router.post(
    "/:paymentId/verify",
    checkAuth(...ADMIN_PANEL_ROLES),
    PaymentController.verifyAdvancePayment,
);

router.post(
    "/:paymentId/reject",
    checkAuth(...ADMIN_PANEL_ROLES),
    validateRequest(rejectPaymentZodSchema),
    PaymentController.rejectAdvancePayment,
);

export const PaymentRoutes = router;

/**
 * The verification queue, mounted at /payments rather than under an order.
 *
 * It reads pending claims across EVERY order, so it cannot live under
 * /orders/:id — there is no one order it belongs to. Its own router, so the
 * parent mount does not have to grow an id it would ignore.
 */
const queueRouter = Router();

queueRouter.get(
    "/pending-verification",
    checkAuth(...ADMIN_PANEL_ROLES),
    PaymentController.getPendingVerifications,
);

export const PaymentQueueRoutes = queueRouter;
