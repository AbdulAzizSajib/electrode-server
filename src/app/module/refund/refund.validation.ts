import z from "zod";

export const createRefundZodSchema = z.object({
    amount: z.number().positive(),
    reason: z.string().max(500).optional(),
    paymentId: z.string().optional(),
    returnRequestId: z.string().optional(),
    /** Set when the returned goods came back and should be restocked — see refund.interface.ts. */
    restockWarehouseId: z.string().optional(),
});

export const updateRefundZodSchema = z
    .object({
        amount: z.number().positive().optional(),
        reason: z.string().max(500).optional(),
    })
    // An empty body would report success while changing nothing, which reads to
    // the operator as though their correction was applied.
    .refine(
        (value) => value.amount !== undefined || value.reason !== undefined,
        "Provide an amount or a reason to change",
    );
