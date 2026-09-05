import { Prisma, PurchaseOrderStatus } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import {
    IPurchaseGroupRow,
    IPurchaseReportRow,
    IPurchaseReportSummary,
    IReportEnvelope,
} from "./report.interface";
import { IResolvedRange, dayKeyInStoreZone, resolveRange } from "./report.range";
import { PurchaseReportQuery } from "./report.validation";

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Which purchase orders the report LISTS.
 *
 * Broader than what it COUNTS: a cancelled purchase order is listed so the
 * merchant can see it existed, but contributes nothing to the money figures,
 * and a draft is excluded from both unless asked for
 * (`admin-reporting/purchase-reports`).
 */
const listWhere = (
    query: PurchaseReportQuery,
    range: IResolvedRange,
): Prisma.PurchaseOrderWhereInput => ({
    createdAt: { gte: range.start, lte: range.end },
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.status
        ? { status: query.status as PurchaseOrderStatus }
        : query.includeDrafts
          ? {}
          : { status: { not: PurchaseOrderStatus.DRAFT } }),
});

/** Statuses whose money counts. A draft is not a commitment; a cancelled one is a withdrawn commitment. */
const countsTowardMoney = (state: PurchaseOrderStatus, includeDrafts: boolean) =>
    state !== PurchaseOrderStatus.CANCELLED &&
    (includeDrafts || state !== PurchaseOrderStatus.DRAFT);

const receiptStateOf = (
    state: PurchaseOrderStatus,
    ordered: number,
    received: number,
): IPurchaseReportRow["receiptState"] => {
    if (state === PurchaseOrderStatus.CANCELLED) return "CANCELLED";
    if (received <= 0) return "AWAITING";
    if (received < ordered) return "PARTIAL";
    return "COMPLETE";
};

const settlementStateOf = (
    purchaseValue: number,
    amountPaid: number,
): IPurchaseReportRow["settlementState"] => {
    if (Math.round(amountPaid * 100) <= 0) return "UNPAID";
    if (Math.round((purchaseValue - amountPaid) * 100) <= 0) return "SETTLED";
    return "PARTIALLY_PAID";
};

const toRows = (
    purchaseOrders: Array<
        Prisma.PurchaseOrderGetPayload<{
            include: {
                supplier: { select: { id: true; name: true; companyName: true; isActive: true } };
                items: { select: { quantity: true; receivedQuantity: true } };
            };
        }>
    >,
    paidByPurchaseOrder: Map<string, number>,
): IPurchaseReportRow[] =>
    purchaseOrders.map((po) => {
        const quantityOrdered = po.items.reduce((sum, item) => sum + item.quantity, 0);
        const quantityReceived = po.items.reduce((sum, item) => sum + item.receivedQuantity, 0);
        const purchaseValue = round2(Number(po.totalAmount));
        const amountPaid = paidByPurchaseOrder.get(po.id) ?? 0;

        return {
            id: po.id,
            purchaseNumber: po.purchaseNumber,
            createdAt: po.createdAt,
            supplierId: po.supplierId,
            supplierName: po.supplier.companyName || po.supplier.name,
            // Marked, not omitted: a deactivated supplier's past purchases are
            // still purchases the merchant made.
            supplierIsActive: po.supplier.isActive,
            status: po.status,
            quantityOrdered,
            quantityReceived,
            quantityOutstanding: Math.max(0, quantityOrdered - quantityReceived),
            subtotal: round2(Number(po.subtotal)),
            shippingCost: round2(Number(po.shippingCost)),
            taxAmount: round2(Number(po.taxAmount)),
            purchaseValue,
            amountPaid,
            balanceOwed: round2(Math.max(0, purchaseValue - amountPaid)),
            settlementState: settlementStateOf(purchaseValue, amountPaid),
            receiptState: receiptStateOf(po.status, quantityOrdered, quantityReceived),
        };
    });

const PURCHASE_INCLUDE = {
    supplier: { select: { id: true, name: true, companyName: true, isActive: true } },
    items: { select: { quantity: true, receivedQuantity: true } },
} as const;

/**
 * Ids of purchase orders in the report's scope that still owe money.
 *
 * Raw SQL for the same reason purchase-order.service.ts uses it: the predicate
 * compares a column against an aggregate over another table, which Prisma's
 * `where` cannot express. Scoped to the range so it stays small.
 */
const owingIdsInRange = async (range: IResolvedRange, supplierId?: string) => {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT po."id"
        FROM "PurchaseOrder" po
        LEFT JOIN (
            SELECT "purchaseOrderId", SUM("amount") AS paid
            FROM "SupplierPayment"
            GROUP BY "purchaseOrderId"
        ) sp ON sp."purchaseOrderId" = po."id"
        WHERE po."createdAt" >= ${range.start}
          AND po."createdAt" <= ${range.end}
          AND po."status" <> 'CANCELLED'
          ${supplierId ? Prisma.sql`AND po."supplierId" = ${supplierId}` : Prisma.empty}
          AND po."totalAmount" - COALESCE(sp.paid, 0) > 0
    `;

    return rows.map((row) => row.id);
};

const resolveWhere = async (query: PurchaseReportQuery, range: IResolvedRange) => {
    const base = listWhere(query, range);
    if (!query.owingOnly) return base;

    return { ...base, id: { in: await owingIdsInRange(range, query.supplierId) } };
};

/** Payment sums for a set of purchase orders, in one round trip. */
const paidFor = async (purchaseOrderIds: string[]) => {
    if (purchaseOrderIds.length === 0) return new Map<string, number>();

    const grouped = await prisma.supplierPayment.groupBy({
        by: ["purchaseOrderId"],
        where: { purchaseOrderId: { in: purchaseOrderIds } },
        _sum: { amount: true },
    });

    return new Map(grouped.map((row) => [row.purchaseOrderId, round2(Number(row._sum.amount ?? 0))]));
};

const fetchSummary = async (
    query: PurchaseReportQuery,
    range: IResolvedRange,
): Promise<IPurchaseReportSummary> => {
    const where = await resolveWhere(query, range);

    // Money figures cover only the purchase orders that count; the drafts and
    // cancellations left out are reported as counts so the totals are never
    // read as covering everything listed.
    const countable = await prisma.purchaseOrder.findMany({
        where,
        select: {
            id: true,
            status: true,
            totalAmount: true,
            items: { select: { quantity: true, receivedQuantity: true } },
        },
    });

    const includeDrafts = Boolean(query.includeDrafts || query.status === "DRAFT");
    const counted = countable.filter((po) => countsTowardMoney(po.status, includeDrafts));
    const paid = await paidFor(counted.map((po) => po.id));

    let quantityOrdered = 0;
    let quantityReceived = 0;
    let purchaseValue = 0;
    let amountPaid = 0;

    for (const po of counted) {
        quantityOrdered += po.items.reduce((sum, item) => sum + item.quantity, 0);
        quantityReceived += po.items.reduce((sum, item) => sum + item.receivedQuantity, 0);
        purchaseValue += Number(po.totalAmount);
        amountPaid += paid.get(po.id) ?? 0;
    }

    return {
        purchaseOrderCount: counted.length,
        quantityOrdered,
        quantityReceived,
        purchaseValue: round2(purchaseValue),
        amountPaid: round2(amountPaid),
        balanceOwed: round2(purchaseValue - amountPaid),
        excludedDraftCount: countable.filter(
            (po) => po.status === PurchaseOrderStatus.DRAFT && !includeDrafts,
        ).length,
        cancelledCount: countable.filter((po) => po.status === PurchaseOrderStatus.CANCELLED).length,
    };
};

const fetchRows = async (
    query: PurchaseReportQuery,
    range: IResolvedRange,
    offset: number,
    limit: number,
): Promise<IPurchaseReportRow[]> => {
    const where = await resolveWhere(query, range);

    const purchaseOrders = await prisma.purchaseOrder.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit,
        include: PURCHASE_INCLUDE,
    });

    return toRows(purchaseOrders, await paidFor(purchaseOrders.map((po) => po.id)));
};

// ------------------------------------------------------------- groupings ---

const fetchGroups = async (
    query: PurchaseReportQuery,
    range: IResolvedRange,
): Promise<IPurchaseGroupRow[] | null> => {
    if (!query.groupBy) return null;

    const where = await resolveWhere(query, range);
    const purchaseOrders = await prisma.purchaseOrder.findMany({ where, include: PURCHASE_INCLUDE });
    const paid = await paidFor(purchaseOrders.map((po) => po.id));
    const rows = toRows(purchaseOrders, paid);

    const includeDrafts = Boolean(query.includeDrafts || query.status === "DRAFT");
    const counted = rows.filter((row) =>
        countsTowardMoney(row.status as PurchaseOrderStatus, includeDrafts),
    );

    const keyOf = (row: IPurchaseReportRow) => {
        if (query.groupBy === "supplier") return { key: row.supplierId, label: row.supplierName };
        if (query.groupBy === "status") return { key: row.status, label: row.status };
        const day = dayKeyInStoreZone(row.createdAt);
        return { key: day, label: day };
    };

    const grouped = new Map<string, IPurchaseGroupRow>();
    for (const row of counted) {
        const { key, label } = keyOf(row);
        const entry = grouped.get(key) ?? {
            key,
            label,
            purchaseOrderCount: 0,
            purchaseValue: 0,
            amountPaid: 0,
            balanceOwed: 0,
        };
        entry.purchaseOrderCount += 1;
        entry.purchaseValue += row.purchaseValue;
        entry.amountPaid += row.amountPaid;
        entry.balanceOwed += row.balanceOwed;
        grouped.set(key, entry);
    }

    const result = [...grouped.values()].map((row) => ({
        ...row,
        purchaseValue: round2(row.purchaseValue),
        amountPaid: round2(row.amountPaid),
        balanceOwed: round2(row.balanceOwed),
    }));

    // Supplier grouping leads with the largest liability, which is the
    // question a merchant opens this grouping to answer.
    return query.groupBy === "supplier"
        ? result.sort((a, b) => b.balanceOwed - a.balanceOwed)
        : result.sort((a, b) => a.key.localeCompare(b.key));
};

export interface IPurchaseReportResult
    extends IReportEnvelope<IPurchaseReportRow, IPurchaseReportSummary> {
    groups: IPurchaseGroupRow[] | null;
    groupBy: PurchaseReportQuery["groupBy"] | null;
}

export const getPurchaseReport = async (
    query: PurchaseReportQuery,
): Promise<IPurchaseReportResult> => {
    const range = resolveRange(query.from, query.to);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = await resolveWhere(query, range);
    const [summary, rows, groups, total] = await Promise.all([
        fetchSummary(query, range),
        fetchRows(query, range, (page - 1) * limit, limit),
        fetchGroups(query, range),
        prisma.purchaseOrder.count({ where }),
    ]);

    return {
        range,
        summary,
        rows,
        groups,
        groupBy: query.groupBy ?? null,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
};

export const fetchPurchaseReportBatch = (
    query: PurchaseReportQuery,
    offset: number,
    limit: number,
): Promise<IPurchaseReportRow[]> =>
    fetchRows(query, resolveRange(query.from, query.to), offset, limit);
