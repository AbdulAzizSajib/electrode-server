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
