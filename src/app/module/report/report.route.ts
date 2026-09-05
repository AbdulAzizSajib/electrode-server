import { Router } from "express";
import { ADMIN_PANEL_ROLES } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateQuery } from "../../middleware/validateQuery";
import { ReportController } from "./report.controller";
import {
    paymentReportQuerySchema,
    purchaseReportQuerySchema,
    salesReportQuerySchema,
    stockHistoryQuerySchema,
    stockReportQuerySchema,
} from "./report.validation";

/**
 * Admin/staff-only, matching analytics.route.ts. Cost prices and supplier
 * balances are the sensitive part, and STAFF can already read both on the
 * Product and Purchase Order pages — restricting the report while leaving its
 * sources open would be theatre (design decision 12).
 *
 * Each route carries `format=csv` on the same endpoint rather than a parallel
 * /export path, so an export cannot drift from the screen it came from.
 */
const router = Router();

router.use(checkAuth(...ADMIN_PANEL_ROLES));

router.get("/stock", validateQuery(stockReportQuerySchema), ReportController.getStockReport);
router.get(
    "/stock-history",
    validateQuery(stockHistoryQuerySchema),
    ReportController.getStockHistoryReport,
);
router.get("/sales", validateQuery(salesReportQuerySchema), ReportController.getSalesReport);
router.get(
    "/purchases",
    validateQuery(purchaseReportQuerySchema),
    ReportController.getPurchaseReport,
);
router.get("/payments", validateQuery(paymentReportQuerySchema), ReportController.getPaymentReport);

export const ReportRoutes = router;
