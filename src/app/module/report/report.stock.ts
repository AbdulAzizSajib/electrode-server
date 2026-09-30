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
            p.id                  AS productId,
            -- Typed explicitly: an untyped NULL in the first arm of a UNION
            -- decides the column's type for both arms, and the second arm
            -- puts a variant id there.
            CAST(NULL AS CHAR)    AS variantId,
            p.name                AS itemName,
            p.sku                 AS sku,
            p.offerPrice          AS offerPrice,
            p.purchasePrice       AS purchasePrice,
            p.stockQuantity       AS cachedQuantity,
            p.lowStockThreshold   AS lowStockThreshold,
            p.categoryId          AS categoryId,
            p.brandId             AS brandId
        FROM Product p
        WHERE p.type = 'SIMPLE'
        UNION ALL
        SELECT
            p.id,
            v.id,
            CONCAT(p.name, ' / ', v.name),
            v.sku,
            COALESCE(v.offerPrice, p.offerPrice),
            COALESCE(v.purchasePrice, p.purchasePrice),
            v.stockQuantity,
            p.lowStockThreshold,
            p.categoryId,
            p.brandId
        FROM ProductVariant v
        JOIN Product p ON p.id = v.productId
    )`;

const stockCte = (warehouseId?: string) => Prisma.sql`
    , stock AS (
        SELECT
            s.productId,
            s.variantId,
            CAST(SUM(s.quantity) AS SIGNED)         AS onHand,
            CAST(SUM(s.reservedQuantity) AS SIGNED) AS reserved
        FROM Stock s
        ${warehouseId ? Prisma.sql`WHERE s.warehouseId = ${warehouseId}` : Prisma.empty}
        GROUP BY s.productId, s.variantId
    )
    -- Named item_rows, not rows: ROWS is a reserved word in MySQL 8 and
    -- MariaDB 10.6+ (window frames), and an unquoted CTE called rows is a
    -- syntax error there.
    , item_rows AS (
        SELECT
            i.*,
            COALESCE(st.onHand, 0)                            AS onHand,
            COALESCE(st.reserved, 0)                          AS reserved,
            COALESCE(st.onHand, 0) - COALESCE(st.reserved, 0) AS available
        FROM items i
        -- <=>, not =, so a simple product's null variantId matches its
        -- null-keyed Stock rows instead of joining to nothing. This is
        -- MySQL's null-safe equality, the same thing PostgreSQL spells
        -- IS NOT DISTINCT FROM.
        LEFT JOIN stock st
               ON st.productId = i.productId
              AND st.variantId <=> i.variantId
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

    if (query.categoryId) conditions.push(Prisma.sql`r.categoryId = ${query.categoryId}`);
    if (query.brandId) conditions.push(Prisma.sql`r.brandId = ${query.brandId}`);
    if (query.searchTerm) {
        // Wildcards the admin typed are escaped so they match literally;
        // without this a search for `50%` matches the whole catalogue.
        const escaped = query.searchTerm.replace(/[\\%_]/g, (char) => `\\${char}`);
        const pattern = `%${escaped}%`;
        // LIKE, not ILIKE: case is folded by the utf8mb4_unicode_ci collation.
        conditions.push(Prisma.sql`(r.itemName LIKE ${pattern} OR r.sku LIKE ${pattern})`);
    }
    if (query.lowStockOnly) conditions.push(Prisma.sql`r.available <= r.lowStockThreshold`);
    if (query.mismatchedOnly && mismatchApplies(query)) {
        conditions.push(Prisma.sql`r.cachedQuantity <> r.onHand`);
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
    offerPrice: Prisma.Decimal | null;
    /** Supplier cost. Legitimate here — this report is admin-only. */
    purchasePrice: Prisma.Decimal | null;
    /*
     * Declared as number because that is what fetchRows returns — it converts
     * them. Straight off the driver these are BigInt; see the note there.
     */
    cachedQuantity: number;
    lowStockThreshold: number;
    onHand: number;
    reserved: number;
    available: number;
}

const fetchRows = async (query: StockReportQuery, offset: number, limit: number) => {
    const rows = await prisma.$queryRaw<IRawStockRow[]>`
        ${itemsCte}${stockCte(query.warehouseId)}
        SELECT r.productId, r.variantId, r.itemName, r.sku, r.offerPrice, r.purchasePrice,
               r.cachedQuantity, r.lowStockThreshold, r.onHand, r.reserved, r.available
        FROM item_rows r
        ${buildFilters(query)}
        -- No NULLS FIRST: MySQL sorts NULLs first on an ascending sort
        -- already, so the clause was a statement of the default and saying
        -- it out loud is a syntax error here.
        ORDER BY r.itemName ASC, r.variantId ASC
        LIMIT ${limit} OFFSET ${offset}
    `;

    /*
     * The integer columns arrive as BigInt, not number.
     *
     * SUM() over an INT column is BIGINT in MySQL, the CAST above keeps it
     * BIGINT, and the driver decodes BIGINT as a JS BigInt — which is the
     * right default for a type that can exceed 2^53, and the wrong type for
     * everything downstream here. BigInt does not silently coerce: the first
     * `onHand * purchasePrice` throws `Cannot mix BigInt and other types`,
     * and `available <= lowStockThreshold` compares a BigInt against a number.
     *
     * Normalised once, here, so the rest of the module works with the numbers
     * IRawStockRow already claims. Number() is exact for any stock quantity a
     * shop could hold — 2^53 units is beyond any real inventory.
     */
    return rows.map((row) => ({
        ...row,
        cachedQuantity: Number(row.cachedQuantity),
        lowStockThreshold: Number(row.lowStockThreshold),
        onHand: Number(row.onHand),
        reserved: Number(row.reserved),
        available: Number(row.available),
    }));
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
        const offerPrice = num(row.offerPrice);
        const purchasePrice = num(row.purchasePrice);
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
            offerPrice,
            purchasePrice,
            // null, never 0: an item with no purchase price is unvalued, and a
            // zero would quietly drag the average and the total down.
            costValue: purchasePrice === null ? null : round2(row.onHand * purchasePrice),
            retailValue: offerPrice === null ? null : round2(row.onHand * offerPrice),
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
            // COUNT/SUM come back as BigInt and DECIMAL as a string - both are the
            // MariaDB driver defaults, kept deliberately (see lib/prisma.ts). Every
            // consumer below already wraps these in Number().
            itemCount: number | bigint;
            totalUnits: number | bigint | null;
            totalCostValue: Prisma.Decimal | string | null;
            totalRetailValue: Prisma.Decimal | string | null;
            lowStockCount: number | bigint;
            unvaluedItemCount: number | bigint;
            unvaluedUnitCount: number | bigint | null;
            mismatchedItemCount: number | bigint;
        }>
    >`
        ${itemsCte}${stockCte(query.warehouseId)}
        -- MySQL has no aggregate FILTER clause: each predicate moves inside
        -- the aggregate as a CASE. COUNT and SUM both ignore NULLs, so an
        -- unmatched row contributes nothing either way, exactly as a failed
        -- FILTER predicate did.
        SELECT
            COUNT(*)                                                     AS itemCount,
            SUM(r.onHand)                                                AS totalUnits,
            SUM(r.onHand * r.purchasePrice)                              AS totalCostValue,
            SUM(r.onHand * r.offerPrice)                                 AS totalRetailValue,
            COUNT(CASE WHEN r.available <= r.lowStockThreshold THEN 1 END) AS lowStockCount,
            COUNT(CASE WHEN r.purchasePrice IS NULL AND r.onHand > 0 THEN 1 END) AS unvaluedItemCount,
            COALESCE(SUM(CASE WHEN r.purchasePrice IS NULL THEN r.onHand END), 0) AS unvaluedUnitCount,
            COUNT(CASE WHEN r.cachedQuantity <> r.onHand THEN 1 END)     AS mismatchedItemCount
        FROM item_rows r
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
