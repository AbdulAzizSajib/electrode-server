import z from "zod";

/**
 * Hand-synced with the `SupplierPaymentMethod` enum in
 * prisma/schema/enums.prisma — Zod cannot read a Prisma enum, so this list and
 * the schema must be changed together, exactly as payment.validation.ts does
 * for `PaymentMethod`. The payload types in supplier-payment.interface.ts
 * derive from the generated enum, so drift here surfaces as a type error at the
 * service boundary rather than at runtime.
 *
 * COD is absent and must stay absent: a supplier payment is money leaving the
 * store, not cash collected from a courier (`inventory/supplier-payments`,
 * "customer-only methods are not offered").
 */
const supplierPaymentMethodEnum = z.enum([
    "CASH",
    "BANK_TRANSFER",
    "CHEQUE",
    "BKASH",
    "NAGAD",
    "ROCKET",
    "CARD",
    "OTHER",
]);

/**
 * `positive()` rather than `nonnegative()`: a zero-amount payment settles
 * nothing and is rejected by the spec, so it is refused at the edge rather
 * than stored as a row that means nothing.
 */
const amountSchema = z
    .number()
    .positive("Payment amount must be greater than zero")
    .max(99_999_999.99, "Payment amount is too large for the stored precision");

export const createSupplierPaymentZodSchema = z.object({
    amount: amountSchema,
    method: supplierPaymentMethodEnum,
    paidAt: z.iso.datetime().optional(),
    reference: z.string().max(150).optional(),
    note: z.string().max(500).optional(),
});

export const updateSupplierPaymentZodSchema = z
    .object({
        amount: amountSchema.optional(),
        method: supplierPaymentMethodEnum.optional(),
        paidAt: z.iso.datetime().optional(),
        // Nullable so a merchant can clear a reference or note they typed by
        // mistake; `undefined` leaves the stored value alone.
        reference: z.string().max(150).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
        message: "Provide at least one field to update",
    });
