import { z } from "zod";

/**
 * See the note on `AuditLogService.deleteAuditLogs` for why deleting these is
 * allowed at all, and what it costs.
 *
 * An explicit id list, not a filter: a filtered purge ("everything before
 * date X") is one mistyped parameter away from erasing the entire trail, and
 * the caller cannot see what it is about to remove. The admin selects rows it
 * has already been shown.
 */
export const deleteAuditLogsZodSchema = z.object({
    ids: z.array(z.string().min(1)).min(1, "Select at least one entry").max(200),
});

export const AuditLogValidation = {
    deleteAuditLogsZodSchema,
};
