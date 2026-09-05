import { Prisma, StockMovementType } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import {
    IReportEnvelope,
    IStockHistoryRow,
    IStockHistorySummary,
} from "./report.interface";
import { IResolvedRange, resolveRange } from "./report.range";
import { StockHistoryQuery } from "./report.validation";

/**
 * Movement types that ADD stock. Every other type removes it.
 *
 * `StockMovement.quantity` is stored signed by the writers in
 * stock.service.ts, but the direction is also encoded in the type, and the
 * opening/in/out arithmetic must not depend on both agreeing. In and out are
 * therefore computed from the absolute quantity partitioned by type, and the
 * opening balance from the same signed convention — so the reconciliation
 * holds whichever sign a historic row happens to carry.
 */
const INBOUND_TYPES: StockMovementType[] = [
    StockMovementType.PURCHASE,
    StockMovementType.RETURN,
    StockMovementType.TRANSFER_IN,
];

const isInbound = (type: StockMovementType) => INBOUND_TYPES.includes(type);

/** Signed contribution of a movement to a balance, derived from its type rather than the stored sign. */
const signedQuantity = (type: StockMovementType, quantity: number) =>
    isInbound(type) ? Math.abs(quantity) : -Math.abs(quantity);

/**
 * Scope shared by the movement list and the opening/in/out/closing figures, so
 * the reconciliation holds for whatever scope is selected. The TYPE filter is
 * deliberately excluded here and applied only to the listed rows — see
 * `isTypeFiltered` on the summary.
 */
const scopeWhere = (query: StockHistoryQuery): Prisma.StockMovementWhereInput => ({
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.variantId ? { variantId: query.variantId } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
});

const listWhere = (query: StockHistoryQuery, range: IResolvedRange): Prisma.StockMovementWhereInput => ({
    ...scopeWhere(query),
    ...(query.type ? { type: query.type as StockMovementType } : {}),
    createdAt: { gte: range.start, lte: range.end },
});

/**
 * Balance at the instant the range opens: every movement in scope strictly
 * BEFORE the range start, summed with the sign its type implies.
 *
 * Zero when the range starts before the item's first ever movement — the spec
 * requires a number there, not a blank.
 */
const computeOpening = async (query: StockHistoryQuery, range: IResolvedRange): Promise<number> => {
    const grouped = await prisma.stockMovement.groupBy({
        by: ["type"],
        where: { ...scopeWhere(query), createdAt: { lt: range.start } },
        _sum: { quantity: true },
    });

    return grouped.reduce(
        (balance, row) => balance + signedQuantity(row.type, Number(row._sum.quantity ?? 0)),
        0,
    );
};

const computeMovementTotals = async (query: StockHistoryQuery, range: IResolvedRange) => {
    const grouped = await prisma.stockMovement.groupBy({
        by: ["type"],
        where: { ...scopeWhere(query), createdAt: { gte: range.start, lte: range.end } },
        _sum: { quantity: true },
        _count: true,
    });

    let quantityIn = 0;
    let quantityOut = 0;

    for (const row of grouped) {
        const magnitude = Math.abs(Number(row._sum.quantity ?? 0));
        if (isInbound(row.type)) quantityIn += magnitude;
        else quantityOut += magnitude;
    }

    return { quantityIn, quantityOut };
};

const fetchRows = async (
    query: StockHistoryQuery,
    range: IResolvedRange,
    offset: number,
    limit: number,
) =>
    prisma.stockMovement.findMany({
        where: listWhere(query, range),
        // Oldest first, so the running balance reads downward as an
        // accumulation rather than needing to be read backwards.
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: offset,
        take: limit,
        include: {
            product: { select: { id: true, name: true } },
            variant: { select: { id: true, name: true } },
            warehouse: { select: { id: true, name: true } },
        },
    });

/**
 * Balance carried into the first row of the requested page.
 *
 * Page 2 cannot start its running balance at `opening` — that would restate
 * page 1's arithmetic. The balance before the page is the opening plus every
 * in-scope movement between the range start and this page's first row.
 */
const balanceBeforeOffset = async (
    query: StockHistoryQuery,
    range: IResolvedRange,
    opening: number,
    offset: number,
): Promise<number> => {
    if (offset === 0) return opening;

    const preceding = await prisma.stockMovement.findMany({
        where: listWhere(query, range),
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: offset,
        select: { type: true, quantity: true },
    });

    return preceding.reduce(
        (balance, row) => balance + signedQuantity(row.type, row.quantity),
        opening,
    );
};

type MovementRow = Awaited<ReturnType<typeof fetchRows>>[number];

const toHistoryRows = (rows: MovementRow[], startingBalance: number): IStockHistoryRow[] => {
    let balance = startingBalance;

    return rows.map((row) => {
        const signed = signedQuantity(row.type, row.quantity);
        balance += signed;

        return {
            id: row.id,
            createdAt: row.createdAt,
            type: row.type,
            quantity: signed,
            productId: row.productId,
            productName: row.product.name,
            variantId: row.variantId,
            variantName: row.variant?.name ?? null,
            warehouseId: row.warehouseId,
            warehouseName: row.warehouse?.name ?? null,
            note: row.note,
            referenceId: row.referenceId,
            balance,
        };
    });
};

export const getStockHistoryReport = async (
    query: StockHistoryQuery,
): Promise<IReportEnvelope<IStockHistoryRow, IStockHistorySummary>> => {
    const range = resolveRange(query.from, query.to);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const [opening, totals, movementCount] = await Promise.all([
        computeOpening(query, range),
        computeMovementTotals(query, range),
        prisma.stockMovement.count({ where: listWhere(query, range) }),
    ]);

    const startingBalance = await balanceBeforeOffset(query, range, opening, offset);
    const rows = await fetchRows(query, range, offset, limit);

    return {
        range,
        summary: {
            opening,
            quantityIn: totals.quantityIn,
            quantityOut: totals.quantityOut,
            // Not queried separately: closing IS opening + in − out, and
            // computing it independently is how the four figures start
            // disagreeing (`admin-reporting/stock-reports`).
            closing: opening + totals.quantityIn - totals.quantityOut,
            movementCount,
            isTypeFiltered: Boolean(query.type),
        },
        rows: toHistoryRows(rows, startingBalance),
        meta: { page, limit, total: movementCount, totalPages: Math.ceil(movementCount / limit) },
    };
};

export const fetchStockHistoryBatch = async (
    query: StockHistoryQuery,
    offset: number,
    limit: number,
): Promise<IStockHistoryRow[]> => {
    const range = resolveRange(query.from, query.to);
    const opening = await computeOpening(query, range);
    const startingBalance = await balanceBeforeOffset(query, range, opening, offset);
    const rows = await fetchRows(query, range, offset, limit);
    return toHistoryRows(rows, startingBalance);
};
