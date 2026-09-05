import { Router } from "express";
import { ADMIN_PANEL_ROLES } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { SupplierPaymentController } from "./supplier-payment.controller";
import {
    createSupplierPaymentZodSchema,
    updateSupplierPaymentZodSchema,
} from "./supplier-payment.validation";

/**
 * Mounted at /purchase-orders/:id/payments — req.params.id is inherited from
 * the parent mount path, the same shape payment.route.ts uses under
 * /orders/:id/payments.
 *
 * Admin/staff-only at the router level, with no per-route widening: what the
 * store owes a supplier is never customer- or anonymous-reachable, and it
 * appears on no storefront surface (`inventory/supplier-payments`).
 */
const router = Router({ mergeParams: true });

router.use(checkAuth(...ADMIN_PANEL_ROLES));

router.post(
    "/",
    validateRequest(createSupplierPaymentZodSchema),
    SupplierPaymentController.recordPayment,
);
router.get("/", SupplierPaymentController.getPurchaseOrderPayments);
router.patch(
    "/:paymentId",
    validateRequest(updateSupplierPaymentZodSchema),
    SupplierPaymentController.updatePayment,
);
router.delete("/:paymentId", SupplierPaymentController.deletePayment);

export const SupplierPaymentRoutes = router;
