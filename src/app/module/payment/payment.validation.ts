import z from "zod";

export const createPaymentZodSchema = z.object({
    method: z.enum(["COD", "CARD", "BKASH", "NAGAD", "ROCKET", "STRIPE", "PAYPAL", "BANK_TRANSFER"]),
    status: z
        .enum(["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"])
        .optional(),
    amount: z.number().nonnegative().optional(),
    transactionId: z.string().max(150).optional(),
    gateway: z.string().max(100).optional(),
    gatewayResponse: z.record(z.string(), z.unknown()).optional(),
    paidAt: z.iso.datetime().optional(),
});
