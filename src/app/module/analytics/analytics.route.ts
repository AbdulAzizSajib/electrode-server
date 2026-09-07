import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { AnalyticsController } from "./analytics.controller";

// Admin/staff-only — computed reporting data, never customer/anonymous-reachable.
const router = Router();
router.use(checkAuth(RoleName.OWNER, RoleName.ADMIN, RoleName.STAFF));

router.get("/dashboard", AnalyticsController.getDashboardSummary);
router.get("/top-products", AnalyticsController.getTopProducts);
router.get("/sales-by-category", AnalyticsController.getSalesByCategory);
router.get("/order-status-breakdown", AnalyticsController.getOrderStatusBreakdown);
router.get("/payment-breakdown", AnalyticsController.getPaymentBreakdown);
router.get("/returns-refunds", AnalyticsController.getReturnsRefunds);

// Polled every few seconds by each open admin tab — see AnalyticsService.getPulse.
router.get("/pulse", AnalyticsController.getPulse);

export const AnalyticsRoutes = router;
