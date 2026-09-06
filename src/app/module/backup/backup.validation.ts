import z from "zod";
import { RESTORE_CONFIRMATION } from "./backup.service";

/**
 * A restore is destructive, so the confirmation is checked as a literal rather
 * than as a boolean flag: a client cannot arrive at `confirmation: "RESTORE"`
 * by accident the way it can arrive at `confirm: true`.
 *
 * Note these schemas are NOT wired through `validateRequest`. That middleware
 * parses `req.body` and replaces it, which does not survive multer's multipart
 * parsing in the same request — the controller applies these directly instead.
 */

export const prepareRestoreZodSchema = z.object({
    confirmation: z.literal(
        RESTORE_CONFIRMATION,
        `A restore deletes all current data. Send confirmation: "${RESTORE_CONFIRMATION}" to proceed.`,
    ),
});

export const confirmRestoreZodSchema = z.object({
    token: z.string().min(1, "A pending restore token is required"),
});
