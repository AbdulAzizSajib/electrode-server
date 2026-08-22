import z from "zod";

export const createRefundZodSchema = z.object({
    amount: z.number().positive(),
    reason: z.string().max(500).optional(),
    paymentId: z.string().optional(),
    returnRequestId: z.string().optional(),
});
