import z from "zod";

// Hand-synced with the PaymentMethod / PaymentStatus enums in
// prisma/schema/enums.prisma — Zod cannot read a Prisma enum, so these lists
// and the schema must be changed together. The TypeScript payload types in
// payment.interface.ts derive from the generated enums, so a drift here shows
// up as a type error at the service boundary rather than at runtime.
const paymentMethodEnum = z.enum([
    "COD",
    "CARD",
    "BKASH",
    "NAGAD",
    "ROCKET",
    "STRIPE",
    "PAYPAL",
    "BANK_TRANSFER",
]);

const paymentStatusEnum = z.enum([
    "PENDING",
    "PROCESSING",
    "PAID",
    "FAILED",
    "CANCELLED",
    "REFUNDED",
    "PARTIALLY_REFUNDED",
]);

export const createPaymentZodSchema = z.object({
    method: paymentMethodEnum,
    status: paymentStatusEnum.optional(),
    amount: z.number().nonnegative().optional(),
    transactionId: z.string().max(150).optional(),
    gateway: z.string().max(100).optional(),
    gatewayResponse: z.record(z.string(), z.unknown()).optional(),
    paidAt: z.iso.datetime().optional(),
});

/** `status` is required — this endpoint exists to change it. */
export const updatePaymentStatusZodSchema = z.object({
    status: paymentStatusEnum,
    transactionId: z.string().max(150).optional(),
    gateway: z.string().max(100).optional(),
    gatewayResponse: z.record(z.string(), z.unknown()).optional(),
    paidAt: z.iso.datetime().optional(),
});
