import { Router } from "express";
import { ALL_ROLES } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { NotificationController } from "./notification.controller";
import { NotificationValidation } from "./notification.validation";

// Every notification is per-user (own-only) — no admin/staff override, per api/support-and-admin spec.
// That applies to the delete routes too: the service scopes every write by
// `req.user.userId`, so there is no way to clear someone else's list.
const router = Router();
router.use(checkAuth(...ALL_ROLES));

router.get("/", NotificationController.getMyNotifications);
router.patch("/read-all", NotificationController.markAllAsRead);
router.patch("/:id/read", NotificationController.markAsRead);

/*
 * Ordering is load-bearing: both literal paths must be registered above
 * `/:id`, or Express matches them as an id and the request 404s on a
 * notification called "all-read".
 *
 * Bulk delete is a POST, not a DELETE with a body. DELETE bodies are permitted
 * by spec but dropped by enough proxies and fetch implementations to be worth
 * avoiding — and `validateRequest` reads `req.body`, so a stripped body would
 * surface as a confusing validation error rather than a transport problem.
 */
router.delete("/all-read", NotificationController.deleteAllRead);
router.post(
    "/bulk-delete",
    validateRequest(NotificationValidation.deleteNotificationsZodSchema),
    NotificationController.deleteNotifications,
);

export const NotificationRoutes = router;
