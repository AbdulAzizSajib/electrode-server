import { z } from "zod";

/**
 * A dispatch selection.
 *
 * The upper bound is enforced here as well as in the service: rejecting 5,000
 * ids before they become a database query is cheaper than rejecting them after,
 * and the service's own check still stands for callers that reach it another way.
 */
export const dispatchOrdersZodSchema = z.object({
    orderIds: z
        .array(z.string().min(1, "Order id cannot be empty"))
        .min(1, "Select at least one order to dispatch.")
        .max(200, "Dispatch at most 200 orders at a time and split the rest into a second batch."),
});

/** The preview takes the same selection — it is the same question, asked first. */
export const previewDispatchZodSchema = dispatchOrdersZodSchema;

export const courierReturnZodSchema = z.object({
    reason: z.string().trim().max(500, "Keep the reason under 500 characters.").optional(),
});

/**
 * The courier's webhook payload.
 *
 * Deliberately permissive about everything except the two fields we act on.
 * `notification_type` and `consignment_id` are what route the notification;
 * anything else Steadfast adds later must not turn a real status update into a
 * 400, because a rejected notification is one nobody re-sends.
 *
 * `consignment_id` accepts both a number and a string: the documented payload
 * types it as an integer, but it is compared against a string column here and
 * coercing at the edge keeps that conversion in one place.
 */
export const courierWebhookZodSchema = z
    .object({
        notification_type: z.string().min(1),
        consignment_id: z.union([z.number(), z.string().min(1)]),
        invoice: z.string().optional(),
        status: z.string().optional(),
        cod_amount: z.union([z.number(), z.string()]).optional(),
        delivery_charge: z.union([z.number(), z.string()]).optional(),
        tracking_message: z.string().optional(),
        updated_at: z.string().optional(),
    })
    .passthrough();
