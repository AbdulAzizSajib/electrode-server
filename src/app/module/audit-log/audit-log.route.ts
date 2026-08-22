import { Router } from "express";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { AuditLogController } from "./audit-log.controller";

// Read-only, OWNER/ADMIN only — no write/delete route exists, per api/support-and-admin spec.
const router = Router();
router.get("/", checkAuth(RoleName.OWNER, RoleName.ADMIN), AuditLogController.getAuditLogs);

export const AuditLogRoutes = router;
