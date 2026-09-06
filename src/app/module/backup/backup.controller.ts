import { Request, Response } from "express";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { BackupService } from "./backup.service";
import { confirmRestoreZodSchema, prepareRestoreZodSchema } from "./backup.validation";

/**
 * `GET /backup/export` — downloads a backup.
 *
 * Sent as a file rather than a JSON envelope: it is a download, and the
 * browser should treat it as one. Follows the `Content-Disposition` pattern
 * `report.csv.ts` established for CSV exports.
 */
const exportBackup = catchAsync(async (req: Request, res: Response) => {
    const artifact = await BackupService.exportBackup(req.user!.userId);

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${artifact.filename}"`);
    // A backup is a point in time; a cached one would be a different point.
    res.setHeader("Cache-Control", "no-store");
    // Lets the admin console show what it just downloaded without re-parsing
    // the file, and lets a client verify it received the whole thing.
    res.setHeader("X-Backup-Schema-Version", artifact.manifest.schemaVersion);
    res.setHeader("X-Backup-Taken-At", artifact.manifest.takenAt);

    res.send(artifact.content);
});

/**
 * `POST /backup/restore` — validates a file and takes the safety backup.
 *
 * Deletes nothing. Returns the safety backup inline (base64) alongside the
 * token, so the operator holds it before the destructive step is offered
 * (design Decision 4).
 */
const prepareRestore = catchAsync(async (req: Request, res: Response) => {
    if (!req.file?.buffer) {
        throw new AppError(status.BAD_REQUEST, "A backup file is required.");
    }

    // Applied here rather than via `validateRequest`: that middleware replaces
    // `req.body` before multer has parsed the multipart form, so the field
    // would not be there yet.
    const parsed = prepareRestoreZodSchema.safeParse(req.body);
    if (!parsed.success) {
        throw new AppError(
            status.BAD_REQUEST,
            parsed.error.issues[0]?.message ?? "A restore confirmation is required.",
        );
    }

    const result = await BackupService.prepareRestore(
        req.user!.userId,
        req.file.buffer,
        parsed.data.confirmation,
    );

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message:
            "Backup file accepted and a safety backup was taken. Save the safety backup, then confirm to apply the restore. Nothing has been changed yet.",
        data: {
            token: result.token,
            expiresAt: new Date(result.expiresAt).toISOString(),
            restoringFrom: result.manifest,
            safetyBackup: {
                filename: result.safetyBackup.filename,
                manifest: result.safetyBackup.manifest,
                /** Gzipped bytes, base64 — the client writes this to a file before confirming. */
                contentBase64: result.safetyBackup.content.toString("base64"),
            },
        },
    });
});

/** `POST /backup/restore/confirm` — applies a validated restore. */
const confirmRestore = catchAsync(async (req: Request, res: Response) => {
    const parsed = confirmRestoreZodSchema.safeParse(req.body);
    if (!parsed.success) {
        throw new AppError(
            status.BAD_REQUEST,
            parsed.error.issues[0]?.message ?? "A pending restore token is required.",
        );
    }

    const summary = await BackupService.confirmRestore(req.user!.userId, parsed.data.token);

    sendResponse(res, {
        httpStatusCode: status.OK,
        success: true,
        message: `Restore complete. ${summary.totalRows} rows restored across ${summary.tables.length} tables.`,
        data: summary,
    });
});

export const BackupController = {
    exportBackup,
    prepareRestore,
    confirmRestore,
};
