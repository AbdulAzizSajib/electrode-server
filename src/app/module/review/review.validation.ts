import z from "zod";

export const createReviewZodSchema = z.object({
    rating: z.number().int().min(1).max(5),
    title: z.string().max(150).optional(),
    comment: z.string().max(2000).optional(),
});

export const updateReviewStatusZodSchema = z.object({
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "HIDDEN"]),
});

export const adminReplyZodSchema = z.object({
    adminReply: z.string().min(1).max(2000),
});

export const updateMyReviewZodSchema = z
    .object({
        rating: z.number().int().min(1).max(5).optional(),
        title: z.string().max(150).optional(),
        comment: z.string().max(2000).optional(),
    })
    // An empty body would reset an APPROVED review to PENDING while changing
    // nothing — a moderation cost with no edit, so reject it outright.
    .refine((payload) => Object.keys(payload).length > 0, {
        message: "Provide at least one of rating, title, or comment",
    });
