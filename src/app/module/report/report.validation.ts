import z from "zod";

/**
 * Every report validates its query string through these schemas via
 * `validateRequest`. Reports deliberately do NOT go through `QueryBuilder`:
 * its `filterableFields` allow-list DROPS unknown params silently, which for a
 * report means confidently returning a wrong number instead of an error — the
 * exact failure audit-log.service.ts already documents. A Zod schema rejects
 * instead.
 */

/** A calendar date, not an instant. The server owns the timezone (see report.range.ts). */
const dateOnly = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD")
    .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), {
        message: "Not a real calendar date",
    });

const rangeShape = {
    from: dateOnly.optional(),
    to: dateOnly.optional(),
};

/**
 * Refuses a backwards range rather than quietly returning nothing: an empty
 * table is indistinguishable from "no sales that month", and the merchant
 * would believe it (`admin-reporting/report-shell`).
 */
const assertRangeOrder = <T extends { from?: string; to?: string }>(schema: z.ZodType<T>) =>
    schema.refine((value) => !value.from || !value.to || value.from <= value.to, {
        message: "The end date cannot be earlier than the start date",
        path: ["to"],
    });

const pagingShape = {
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
};

/**
 * `format=csv` switches the same endpoint from a paged JSON page to a streamed
 * full-result download. One endpoint rather than a parallel /export route, so
 * the export can never answer a subtly different question than the screen
 * (design decision 7).
 */
const formatShape = {
    format: z.enum(["json", "csv"]).optional(),
};

const booleanish = z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional();

export const stockReportQuerySchema = z.object({
    ...pagingShape,
    ...formatShape,
    // No date range: the stock report states a present position, not a period.
    warehouseId: z.string().optional(),
    categoryId: z.string().optional(),
    brandId: z.string().optional(),
    searchTerm: z.string().max(200).optional(),
    lowStockOnly: booleanish,
    mismatchedOnly: booleanish,
});

export const stockHistoryQuerySchema = assertRangeOrder(
    z.object({
        ...rangeShape,
        ...pagingShape,
        ...formatShape,
        productId: z.string().optional(),
        variantId: z.string().optional(),
        warehouseId: z.string().optional(),
        type: z
            .enum([
                "PURCHASE",
                "SALE",
                "RETURN",
                "REFUND",
                "ADJUSTMENT",
                "DAMAGE",
                "LOSS",
                "TRANSFER_IN",
                "TRANSFER_OUT",
            ])
            .optional(),
    }),
);

export const salesReportQuerySchema = assertRangeOrder(
    z.object({
        ...rangeShape,
        ...pagingShape,
        ...formatShape,
        groupBy: z.enum(["day", "product", "category", "method"]).optional(),
        // CANCELLED is absent on purpose: cancelled orders are excluded from
        // this report by definition, so offering it would promise a filter that
        // can only ever return nothing.
        status: z
            .enum(["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"])
            .optional(),
        method: z
            .enum([
                "COD",
                "CARD",
                "BKASH",
                "NAGAD",
                "ROCKET",
                "STRIPE",
                "PAYPAL",
                "BANK_TRANSFER",
                "OTHER",
            ])
            .optional(),
        guestOnly: booleanish,
    }),
);

export const purchaseReportQuerySchema = assertRangeOrder(
    z.object({
        ...rangeShape,
        ...pagingShape,
        ...formatShape,
        groupBy: z.enum(["supplier", "status", "day"]).optional(),
        supplierId: z.string().optional(),
        status: z
            .enum(["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"])
            .optional(),
        includeDrafts: booleanish,
        owingOnly: booleanish,
    }),
);

export const paymentReportQuerySchema = assertRangeOrder(
    z.object({
        ...rangeShape,
        ...pagingShape,
        ...formatShape,
        direction: z.enum(["IN", "OUT"]).optional(),
        method: z.string().max(40).optional(),
        status: z.string().max(40).optional(),
        customerId: z.string().optional(),
        supplierId: z.string().optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
    }),
);

export type StockReportQuery = z.infer<typeof stockReportQuerySchema>;
export type StockHistoryQuery = z.infer<typeof stockHistoryQuerySchema>;
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
export type PurchaseReportQuery = z.infer<typeof purchaseReportQuerySchema>;
export type PaymentReportQuery = z.infer<typeof paymentReportQuerySchema>;
