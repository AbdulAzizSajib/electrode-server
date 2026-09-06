import { Router } from "express";
import { multerUpload } from "../../config/multer.config";
import { RoleName } from "../../constants/role.constant";
import { checkAuth } from "../../middleware/checkAuth";
import { BackupController } from "./backup.controller";

const router = Router();

/*
 * OWNER only — deliberately narrower than the rest of the admin panel, which
 * admits ADMIN and often STAFF.
 *
 * A backup file contains every customer record in the shop and every
 * credential row; a restore silently rewrites the whole shop. Neither is
 * something an ADMIN should be able to do without the owner knowing. See
 * add-database-backup-restore design.md Decision 5.
 */
router.get("/export", checkAuth(RoleName.OWNER), BackupController.exportBackup);

// Two steps on purpose: this one validates the file and hands back a safety
// backup, and deletes nothing. See design Decision 4.
router.post(
    "/restore",
    checkAuth(RoleName.OWNER),
    multerUpload.single("backup"),
    BackupController.prepareRestore,
);

router.post("/restore/confirm", checkAuth(RoleName.OWNER), BackupController.confirmRestore);

export const BackupRoutes = router;
