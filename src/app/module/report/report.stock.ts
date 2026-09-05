import { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import {
    IReportEnvelope,
    IStockReportRow,
    IStockReportSummary,
} from "./report.interface";
import { StockReportQuery } from "./report.validation";

const round2 = (value: number) => Math.round(value * 100) / 100;
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/**
 * The stock report's item list, as SQL.
 *
 * Driven from Product/ProductVariant with a LEFT JOIN onto the Stock aggregate
 * rather than from Stock (design decision 6): an item that has never received
 * stock must still appear with zeros, and it is exactly those rows a merchant
 * is looking for. Driving from Stock would omit them.
 *
 * A variable product contributes one row per variant and no combined row,
 * because stock is held per variant. A simple product contributes itself with
 * a null variantId, which is how its Stock rows are keyed.
 *
 * Price and cost fall back from the variant to its product, so a variant that
 * does not override them is still valued.
 */
const itemsCte = Prisma.sql`
    WITH items AS (
        SELECT
            p."id"                AS "productId",
            NULL::text            AS "variantId",
            p."name"              AS "itemName",
            p."sku"               AS "sku",
            p."price"             AS "price",
            p."costPrice"         AS "costPrice",
            p."stockQuantity"     AS "cachedQuantity",
            p."lowStockThreshold" AS "lowStockThreshold",
            p."categoryId"        AS "categoryId",
            p."brandId"           AS "brandId"
        FROM "Product" p
        WHERE p."type" = 'SIMPLE'
        UNION ALL
        SELECT
            p."id",
            v."id",
            p."name" || ' / ' || v."name",
            v."sku",
            COALESCE(v."price", p."price"),
            COALESCE(v."costPrice", p."costPrice"),
            v."stockQuantity",
            p."lowStockThreshold",
            p."categoryId",
            p."brandId"
        FROM "ProductVariant" v
        JOIN "Product" p ON p."id" = v."productId"
    )`;

const stockCte = (warehouseId?: string) => Prisma.sql`
    , stock AS (
        SELECT
            s."productId",
            s."variantId",
            SUM(s."quantity")::int         AS "onHand",
            SUM(s."reservedQuantity")::int AS "reserved"
        FROM "Stock" s
        ${warehouseId ? Prisma.sql`WHERE s."warehouseId" = ${warehouseId}` : Prisma.empty}
        GROUP BY s."productId", s."variantId"
    )
    , rows AS (
        SELECT
            i.*,
            COALESCE(st."onHand", 0)                              AS "onHand",
            COALESCE(st."reserved", 0)                            AS "reserved",
            COALESCE(st."onHand", 0) - COALESCE(st."reserved", 0) AS "available"
        FROM items i
        -- IS NOT DISTINCT FROM, not =, so a simple product's null variantId
        -- matches its null-keyed Stock rows instead of joining to nothing.
        LEFT JOIN stock st
               ON st."productId" = i."productId"
              AND st."variantId" IS NOT DISTINCT FROM i."variantId"
    )`;

/**
 * `mismatchedOnly` and `hasQuantityMismatch` are meaningless while a warehouse
 * filter is applied: the cached mirror counts stock across ALL warehouses, so
 * comparing it against one warehouse's total would flag every multi-warehouse
 * item as broken. Suppressed rather than shown wrong.
 */
const mismatchApplies = (query: StockReportQuery) => !query.warehouseId;

const buildFilters = (query: StockReportQuery) => {
    const conditions: Prisma.Sql[] = [];

    if (query.categoryId) conditions.push(Prisma.sql`r."categoryId" = ${query.categoryId}`);
    if (query.brandId) conditions.push(Prisma.sql`r."brandId" = ${query.brandId}`);
    if (query.searchTerm) {
        const pattern = `%${query.searchTerm}%`;
        conditions.push(Prisma.sql`(r."itemName" ILIKE ${pattern} OR r."sku" ILIKE ${pattern})`);
    }
    if (query.lowStockOnly) conditions.push(Prisma.sql`r."available" <= r."lowStockThreshold"`);
    if (query.mismatchedOnly && mismatchApplies(query)) {
        conditions.push(Prisma.sql`r."cachedQuantity" <> r."onHand"`);
    }

    return conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;
};

interface IRawStockRow {
    productId: string;
    variantId: string | null;
    itemName: string;
    sku: string | null;
    price: Prisma.Decimal | null;
    costPrice: Prisma.Decimal | null;
    cachedQuantity: number;
    lowStockThreshold: number;
    onHand: number;
    reserved: number;
    available: number;
}

const fetchRows = async (query: StockReportQuery, offset: number, limit: number) => {
    const rows = await prisma.$queryRaw<IRawStockRow[]>`
        ${itemsCte}${stockCte(query.warehouseId)}
        SELECT r."productId", r."variantId", r."itemName", r."sku", r."price", r."costPrice",
               r."cachedQuantity", r."lowStockThreshold", r."onHand", r."reserved", r."available"
        FROM rows r
        ${buildFilters(query)}
        ORDER BY r."itemName" ASC, r."variantId" ASC NULLS FIRST
        LIMIT ${limit} OFFSET ${offset}
    `;

    return rows;
};

/** Per-warehouse split for the rows on the current page only — the whole catalogue's split is not something any screen shows at once. */
const attachWarehouseSplit = async (
    rows: IRawStockRow[],
    warehouseId?: string,
): Promise<IStockReportRow[]> => {
    const productIds = [...new Set(rows.map((row) => row.productId))];

    const stockRows =
        productIds.length === 0
            ? []
            : await prisma.stock.findMany({
                  where: {
                      productId: { in: productIds },
                      ...(warehouseId ? { warehouseId } : {}),
                  },
                  select: {
                      productId: true,
                      variantId: true,
                      quantity: true,
                      reservedQuantity: true,
                      warehouse: { select: { id: true, name: true } },
                  },
              });

    const key = (productId: string, variantId: string | null) => `${productId}::${variantId ?? ""}`;
    const splitByItem = new Map<string, IStockReportRow["warehouses"]>();

    for (const row of stockRows) {
        const mapKey = key(row.productId, row.variantId);
        const list = splitByItem.get(mapKey) ?? [];
        list.push({
            warehouseId: row.warehouse.id,
            warehouseName: row.warehouse.name,
            quantity: row.quantity,
            reserved: row.reservedQuantity,
        });
        splitByItem.set(mapKey, list);
    }

    return rows.map((row) => {
        const price = num(row.price);
        const costPrice = num(row.costPrice);
        const hasQuantityMismatch = !warehouseId && row.cachedQuantity !== row.onHand;

        return {
            productId: row.productId,
            variantId: row.variantId,
            itemName: row.itemName,
            sku: row.sku,
            onHand: row.onHand,
            reserved: row.reserved,
            available: row.available,
            cachedQuantity: row.cachedQuantity,
            hasQuantityMismatch,
            lowStockThreshold: row.lowStockThreshold,
            isLowStock: row.available <= row.lowStockThreshold,
            price,
            costPrice,
            // null, never 0: an item with no cost price is unvalued, and a zero
            // would quietly drag the average and the total down.
            costValue: costPrice === null ? null : round2(row.onHand * costPrice),
            retailValue: price === null ? null : round2(row.onHand * price),
            warehouses: (splitByItem.get(key(row.productId, row.variantId)) ?? []).sort((a, b) =>
                a.warehouseName.localeCompare(b.warehouseName),
            ),
        };
    });
};

/** Totals over the WHOLE filtered result, as separate aggregates — never a sum of the page (`admin-reporting/report-shell`). */
const fetchSummary = async (query: StockReportQuery): Promise<IStockReportSummary> => {
    const [row] = await prisma.$queryRaw<
        Array<{
            itemCount: bigint;
            totalUnits: bigint | null;
            totalCostValue: Prisma.Decimal | null;
            totalRetailValue: Prisma.Decimal | null;
            lowStockCount: bigint;
            unvaluedItemCount: bigint;
            unvaluedUnitCount: bigint | null;
            mismatchedItemCount: bigint;
        }>
    >`
        ${itemsCte}${stockCte(query.warehouseId)}
        SELECT
            COUNT(*)                                                       AS "itemCount",
            SUM(r."onHand")                                                AS "totalUnits",
            SUM(r."onHand" * r."costPrice")                                AS "totalCostValue",
            SUM(r."onHand" * r."price")                                    AS "totalRetailValue",
            COUNT(*) FILTER (WHERE r."available" <= r."lowStockThreshold") AS "lowStockCount",
            COUNT(*) FILTER (WHERE r."costPrice" IS NULL AND r."onHand" > 0) AS "unvaluedItemCount",
            COALESCE(SUM(r."onHand") FILTER (WHERE r."costPrice" IS NULL), 0) AS "unvaluedUnitCount",
            COUNT(*) FILTER (WHERE r."cachedQuantity" <> r."onHand")       AS "mismatchedItemCount"
        FROM rows r
        ${buildFilters(query)}
    `;

    return {
        itemCount: Number(row?.itemCount ?? 0),
        totalUnits: Number(row?.totalUnits ?? 0),
        // SUM ignores NULLs, so an item with no cost price contributes nothing
        // here rather than being counted as zero cost.
        totalCostValue: round2(Number(row?.totalCostValue ?? 0)),
        totalRetailValue: round2(Number(row?.totalRetailValue ?? 0)),
        lowStockCount: Number(row?.lowStockCount ?? 0),
        unvaluedItemCount: Number(row?.unvaluedItemCount ?? 0),
        unvaluedUnitCount: Number(row?.unvaluedUnitCount ?? 0),
        mismatchedItemCount: mismatchApplies(query) ? Number(row?.mismatchedItemCount ?? 0) : 0,
    };
};

export const getStockReport = async (
    query: StockReportQuery,
): Promise<IReportEnvelope<IStockReportRow, IStockReportSummary>> => {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [summary, rawRows] = await Promise.all([
        fetchSummary(query),
        fetchRows(query, (page - 1) * limit, limit),
    ]);

    return {
        // No range: the stock report states a present position, not a period.
        range: null,
        summary,
        rows: await attachWarehouseSplit(rawRows, query.warehouseId),
        meta: {
            page,
            limit,
            total: summary.itemCount,
            totalPages: Math.ceil(summary.itemCount / limit),
        },
    };
};

/** Batch fetcher for the CSV stream — same filters and same ordering as the screen. */
export const fetchStockReportBatch = async (
    query: StockReportQuery,
    offset: number,
    limit: number,
): Promise<IStockReportRow[]> => {
    const rows = await fetchRows(query, offset, limit);
    return attachWarehouseSplit(rows, query.warehouseId);
};
