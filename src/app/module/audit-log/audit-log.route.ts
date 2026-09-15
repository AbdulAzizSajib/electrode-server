import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogValidation } from "./audit-log.validation";

/*
 * Reading is OWNER/ADMIN; pruning is OWNER only.
 *
 * The narrower role on delete is the point, not an oversight — see the note on
 * `AuditLogService.deleteAuditLogs` for what pruning costs and what still holds
 * the line. An ADMIN can read the whole trail and cannot remove any of it.
 */
const router = Router();
router.get("/", checkAuth(RoleName.OWNER, RoleName.ADMIN), AuditLogController.getAuditLogs);

// POST rather than DELETE-with-body: DELETE bodies are dropped by enough
// proxies and fetch implementations that `validateRequest` would report a
// missing `ids` array for what is really a transport problem.
router.post(
    "/bulk-delete",
    checkAuth(RoleName.OWNER),
    validateRequest(AuditLogValidation.deleteAuditLogsZodSchema),
    AuditLogController.deleteAuditLogs,
);

export const AuditLogRoutes = router;
