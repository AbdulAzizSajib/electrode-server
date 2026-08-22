import { Router } from "express";
import { ALL_ROLES } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { NotificationController } from "./notification.controller";

// Every notification is per-user (own-only) — no admin/staff override, per api/support-and-admin spec.
const router = Router();
router.use(checkAuth(...ALL_ROLES));

router.get("/", NotificationController.getMyNotifications);
router.patch("/read-all", NotificationController.markAllAsRead);
router.patch("/:id/read", NotificationController.markAsRead);

export const NotificationRoutes = router;
