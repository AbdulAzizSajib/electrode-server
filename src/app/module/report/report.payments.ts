import z from "zod";
import { Prisma, RefundStatus } from "../../../generated/prisma/client";
import { SETTLED_PAYMENT_STATUSES } from "../../constants/sales.constant";
import { prisma } from "../../lib/prisma";
import {
    IPaymentReportRow,
    IPaymentReportSummary,
    IReportEnvelope,
} from "./report.interface";
import { IResolvedRange, resolveRange } from "./report.range";
import { PaymentReportQuery } from "./report.validation";

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Payment history is one SQL `UNION ALL` over Payment (money in) and
 * SupplierPayment (money out) — design decision 4.
 *
 * Prisma has no cross-model union. The JavaScript alternative (fetch
 * offset+limit from both tables, merge, slice) either over-fetches badly on
 * later pages or paginates incorrectly, and cannot produce whole-result totals
 * without two more queries. One statement gets correct ordering, correct paging
 * and correct totals together.
 *
 * SAFETY: every value below is bound through a `Prisma.sql` parameter. Nothing
 * is string-interpolated, and the sort column is a fixed literal with only the
 * direction chosen from a two-value allow-list.
 */

/** Settled statuses as bound parameters, compared straight against the ENUM column. */
const settledList = Prisma.join(SETTLED_PAYMENT_STATUSES.map((value) => Prisma.sql`${value}`));

const moneyInSelect = (query: PaymentReportQuery, range: IResolvedRange) => {
    const conditions: Prisma.Sql[] = [
        // Dated by when the money moved — the settlement date when there is
        // one, the record date otherwise (design decision 5). Dating
        // everything by createdAt would put a February-recorded, March-settled
        // payment in February; dating only by paidAt would drop every
        // uncollected COD payment, which is the row a merchant is hunting for.
        Prisma.sql`COALESCE(p.paidAt, p.createdAt) >= ${range.start}`,
        Prisma.sql`COALESCE(p.paidAt, p.createdAt) <= ${range.end}`,
    ];

    if (query.method) conditions.push(Prisma.sql`p.method = ${query.method}`);
    if (query.status) conditions.push(Prisma.sql`p.status = ${query.status}`);
    if (query.customerId) conditions.push(Prisma.sql`o.customerId = ${query.customerId}`);

    return Prisma.sql`
        SELECT
            p.id                                         AS id,
            'IN'                                         AS direction,
            COALESCE(p.paidAt, p.createdAt)              AS effectiveDate,
            (p.status IN (${settledList}))               AS isSettled,
            p.amount                                     AS amount,
            p.method                                     AS method,
            p.status                                     AS status,
            c.id                                         AS counterpartyId,
            NULLIF(TRIM(CONCAT(COALESCE(c.firstName, ''), ' ', COALESCE(c.lastName, ''))), '') AS counterpartyName,
            COALESCE(o.isGuestOrder, FALSE)              AS isGuest,
            o.id                                         AS documentId,
            o.orderNumber                                AS documentNumber,
            p.transactionId                              AS reference
        FROM Payment p
        -- LEFT, not INNER: a payment whose document has gone is still money
        -- that moved, and the spec requires the row to survive with the
        -- missing document stated.
        --
        -- The Order table is backtick-quoted because ORDER is a reserved word
        -- in MySQL. The backticks are escaped because this is a JS template
        -- literal, where an unescaped one would end the string; every other
        -- identifier in this file is safe unquoted, which is why only this
        -- one carries them.
        LEFT JOIN \`Order\` o  ON o.id = p.orderId
        LEFT JOIN Customer c   ON c.id = o.customerId
        WHERE ${Prisma.join(conditions, " AND ")}
    `;
};

const moneyOutSelect = (query: PaymentReportQuery, range: IResolvedRange) => {
    const conditions: Prisma.Sql[] = [
        Prisma.sql`sp.paidAt >= ${range.start}`,
        Prisma.sql`sp.paidAt <= ${range.end}`,
    ];

    if (query.method) conditions.push(Prisma.sql`sp.method = ${query.method}`);
    if (query.supplierId) conditions.push(Prisma.sql`sp.supplierId = ${query.supplierId}`);
    // A supplier payment has no lifecycle — it is recorded because it happened
    // — so it is only ever PAID. A status filter for anything else excludes
    // the whole side rather than matching nothing row by row.
    if (query.status && query.status !== "PAID") conditions.push(Prisma.sql`FALSE`);

    return Prisma.sql`
        SELECT
            sp.id                                        AS id,
            'OUT'                                        AS direction,
            sp.paidAt                                    AS effectiveDate,
            TRUE                                         AS isSettled,
            sp.amount                                    AS amount,
            sp.method                                    AS method,
            'PAID'                                       AS status,
            s.id                                         AS counterpartyId,
            COALESCE(NULLIF(s.companyName, ''), s.name)  AS counterpartyName,
            FALSE                                        AS isGuest,
            po.id                                        AS documentId,
            po.purchaseNumber                            AS documentNumber,
            sp.reference                                 AS reference
        FROM SupplierPayment sp
        LEFT JOIN Supplier s       ON s.id = sp.supplierId
        LEFT JOIN PurchaseOrder po ON po.id = sp.purchaseOrderId
        WHERE ${Prisma.join(conditions, " AND ")}
    `;
};

/**
 * The union, narrowed by direction.
 *
 * A `customerId` filter implies money in and a `supplierId` filter implies
 * money out — including the other side would return rows that cannot match.
 */
const unionSql = (query: PaymentReportQuery, range: IResolvedRange) => {
    const wantsIn = query.direction !== "OUT" && !query.supplierId;
    const wantsOut = query.direction !== "IN" && !query.customerId;

    if (wantsIn && wantsOut) {
        return Prisma.sql`${moneyInSelect(query, range)} UNION ALL ${moneyOutSelect(query, range)}`;
    }
    if (wantsIn) return moneyInSelect(query, range);
    if (wantsOut) return moneyOutSelect(query, range);

    // Both sides excluded (a customer and a supplier filter together): a real
    // empty result, expressed as a query rather than a special case.
    return Prisma.sql`${moneyInSelect(query, range)} LIMIT 0`;
};

/**
 * Raw SQL loses Prisma's typing, so the result is parsed before it leaves the
 * service: a schema change that breaks a column fails loudly here rather than
 * producing wrong rows downstream (design.md — Risks).
 */
/**
 * MySQL has no boolean type: a comparison in a SELECT list comes back as
 * TINYINT 1/0, and a BOOLEAN column as 1/0 too. No driver option changes
 * that, so the boolean columns are decoded here rather than asserted to be
 * something they never are. Anything else in this schema stays strict on
 * purpose — the point of parsing is that a schema change fails loudly.
 */
const sqlBoolean = z
    .union([z.boolean(), z.number(), z.bigint()])
    .transform((value) => Boolean(Number(value)));

const rawRowSchema = z.object({
    id: z.string(),
    direction: z.enum(["IN", "OUT"]),
    effectiveDate: z.date(),
    isSettled: sqlBoolean,
    amount: z.union([z.number(), z.instanceof(Prisma.Decimal), z.string()]),
    method: z.string(),
    status: z.string(),
    counterpartyId: z.string().nullable(),
    counterpartyName: z.string().nullable(),
    isGuest: sqlBoolean,
    documentId: z.string().nullable(),
    documentNumber: z.string().nullable(),
    reference: z.string().nullable(),
});

const toRow = (raw: z.infer<typeof rawRowSchema>): IPaymentReportRow => ({
    id: raw.id,
    direction: raw.direction,
    effectiveDate: raw.effectiveDate,
    isSettled: raw.isSettled,
    amount: round2(Number(raw.amount)),
    method: raw.method,
    status: raw.status,
    counterpartyId: raw.counterpartyId,
    // Never blank: an unnamed counterparty reads as a rendering bug.
    counterpartyName: raw.counterpartyName ?? (raw.direction === "IN" ? "Guest" : "Unknown supplier"),
    isGuest: raw.isGuest,
    documentId: raw.documentId,
    documentNumber: raw.documentNumber,
    reference: raw.reference,
});

const fetchRows = async (
    query: PaymentReportQuery,
    range: IResolvedRange,
    offset: number,
    limit: number,
): Promise<IPaymentReportRow[]> => {
    // Fixed column, direction from a two-value allow-list — never request text.
    const direction = query.sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const rows = await prisma.$queryRaw<unknown[]>`
        SELECT * FROM (${unionSql(query, range)}) AS movements
        ORDER BY movements.effectiveDate ${direction}, movements.id ${direction}
        LIMIT ${limit} OFFSET ${offset}
    `;

    return rows.map((row) => toRow(rawRowSchema.parse(row)));
};

const fetchSummary = async (
    query: PaymentReportQuery,
    range: IResolvedRange,
): Promise<IPaymentReportSummary> => {
    const [totals] = await prisma.$queryRaw<
        Array<{
            // DECIMAL arrives as a string from the MariaDB driver (its default;
            // a float cannot hold money) - see lib/prisma.ts.
            moneyIn: Prisma.Decimal | string | null;
            moneyOut: Prisma.Decimal | string | null;
            pending: Prisma.Decimal | string | null;
            // COUNT(*) is BIGINT, which the driver hands back as a JS BigInt.
            inCount: number | bigint;
            outCount: number | bigint;
        }>
    >`
        -- MySQL has no aggregate FILTER clause, so each filter moves inside the
        -- aggregate as a CASE. Equivalent, not approximately so: SUM ignores
        -- NULLs and COUNT ignores NULLs, so an unmatched row contributes
        -- nothing either way, exactly as a failed FILTER predicate did.
        SELECT
            -- Settled rows only. An uncollected COD amount is stated as
            -- pending below and never added to money in.
            COALESCE(SUM(CASE WHEN m.direction = 'IN'  AND m.isSettled     THEN m.amount END), 0) AS moneyIn,
            COALESCE(SUM(CASE WHEN m.direction = 'OUT'                    THEN m.amount END), 0) AS moneyOut,
            COALESCE(SUM(CASE WHEN m.direction = 'IN'  AND NOT m.isSettled THEN m.amount END), 0) AS pending,
            COUNT(CASE WHEN m.direction = 'IN'  THEN 1 END)  AS inCount,
            COUNT(CASE WHEN m.direction = 'OUT' THEN 1 END)  AS outCount
        FROM (${unionSql(query, range)}) AS m
    `;

    // Refunds against payments inside the range, stated separately rather than
    // silently removed from money in (`admin-reporting/payment-reports`).
    const refunded = await prisma.refund.aggregate({
        where: {
            status: RefundStatus.COMPLETED,
            payment: { is: { OR: [{ paidAt: { gte: range.start, lte: range.end } }] } },
        },
        _sum: { amount: true },
    });

    const moneyIn = round2(Number(totals?.moneyIn ?? 0));
    const moneyOut = round2(Number(totals?.moneyOut ?? 0));

    return {
        moneyIn,
        moneyOut,
        net: round2(moneyIn - moneyOut),
        pending: round2(Number(totals?.pending ?? 0)),
        refunded: round2(Number(refunded._sum.amount ?? 0)),
        inCount: Number(totals?.inCount ?? 0),
        outCount: Number(totals?.outCount ?? 0),
    };
};

export const getPaymentReport = async (
    query: PaymentReportQuery,
): Promise<IReportEnvelope<IPaymentReportRow, IPaymentReportSummary>> => {
    const range = resolveRange(query.from, query.to);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [summary, rows] = await Promise.all([
        fetchSummary(query, range),
        fetchRows(query, range, (page - 1) * limit, limit),
    ]);

    const total = summary.inCount + summary.outCount;

    return {
        range,
        summary,
        rows,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

export const fetchPaymentReportBatch = (
    query: PaymentReportQuery,
    offset: number,
    limit: number,
): Promise<IPaymentReportRow[]> =>
    fetchRows(query, resolveRange(query.from, query.to), offset, limit);
