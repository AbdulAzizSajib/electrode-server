import { z } from "zod";

/**
 * Bulk delete takes an explicit id list rather than a filter.
 *
 * A filter ("delete everything matching X") would let a mistyped or omitted
 * parameter clear the whole table, and the caller could not tell beforehand
 * what it was about to remove. An id list is bounded by what the admin actually
 * selected in the UI, and the response can report how many of those ids were
 * really theirs.
 *
 * `.max(200)` matches the largest page the admin can select at once. It is a
 * guard on payload size, not a business rule — a caller with more to remove
 * sends more than one request.
 */
export const deleteNotificationsZodSchema = z.object({
    ids: z.array(z.string().min(1)).min(1, "Select at least one notification").max(200),
});

export const NotificationValidation = {
    deleteNotificationsZodSchema,
};
