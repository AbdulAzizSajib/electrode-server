import { Prisma, RefundStatus } from "../../../generated/prisma/client";
import { SALES_ORDER_WHERE, SETTLED_PAYMENT_STATUSES } from "../../constants/sales.constant";
import { prisma } from "../../lib/prisma";
import {
    IReportEnvelope,
    ISalesGroupRow,
    ISalesOrderRow,
    ISalesReportSummary,
} from "./report.interface";
import { IResolvedRange, dayKeyInStoreZone, resolveRange } from "./report.range";
import { SalesReportQuery } from "./report.validation";

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Which orders this report is about.
 *
 * `SALES_ORDER_WHERE` is imported rather than restated so the dashboard and
 * this report cannot state different revenue for the same window — the one
 * thing `admin-reporting/sales-reports` requires structurally (design decision
 * 2). Placement date, not delivery or payment date, decides the period.
 */
const orderWhere = (query: SalesReportQuery, range: IResolvedRange): Prisma.OrderWhereInput => ({
    ...SALES_ORDER_WHERE,
    createdAt: { gte: range.start, lte: range.end },
    ...(query.status ? { status: query.status } : {}),
    ...(query.guestOnly ? { isGuestOrder: true } : {}),
    // A method filter narrows to orders that have a payment by that method —
    // the order is the unit of this report, so the filter selects orders, not
    // payments.
    ...(query.method ? { payments: { some: { method: query.method } } } : {}),
});

/** Settled payments belonging to the report's orders. Only these count as collected. */
const collectedWhere = (
    query: SalesReportQuery,
    range: IResolvedRange,
): Prisma.PaymentWhereInput => ({
    status: { in: SETTLED_PAYMENT_STATUSES },
    ...(query.method ? { method: query.method } : {}),
    order: orderWhere(query, range),
});

const fetchSummary = async (
    query: SalesReportQuery,
    range: IResolvedRange,
): Promise<ISalesReportSummary> => {
    const where = orderWhere(query, range);

    const [orders, collected, refunded] = await Promise.all([
        prisma.order.aggregate({
            where,
            _count: true,
            _sum: {
                subtotal: true,
                discountAmount: true,
                shippingAmount: true,
                taxAmount: true,
                totalAmount: true,
            },
        }),
        prisma.payment.aggregate({ where: collectedWhere(query, range), _sum: { amount: true } }),
        // Attributed to the period of the ORDER, not of the refund: an order
        // placed in March and refunded in April belongs to March in both
        // figures, so an order and its refund are never split across two
        // reports (`admin-reporting/sales-reports`).
        prisma.refund.aggregate({
            where: { status: RefundStatus.COMPLETED, order: where },
            _sum: { amount: true },
        }),
    ]);

    const orderTotal = round2(Number(orders._sum.totalAmount ?? 0));
    const collectedAmount = round2(Number(collected._sum.amount ?? 0));
    const refundedAmount = round2(Number(refunded._sum.amount ?? 0));

    return {
        orderCount: orders._count,
        grossSales: round2(Number(orders._sum.subtotal ?? 0)),
        discount: round2(Number(orders._sum.discountAmount ?? 0)),
        shipping: round2(Number(orders._sum.shippingAmount ?? 0)),
        tax: round2(Number(orders._sum.taxAmount ?? 0)),
        orderTotal,
        collected: collectedAmount,
        // Never negative: an over-collection (a duplicate payment) is a data
        // problem, not money the merchant is owed backwards.
        outstanding: round2(Math.max(0, orderTotal - collectedAmount)),
        // Refunds are their OWN figure and never reduce sales — the spec is
        // explicit that a fully refunded ৳5,000 order still counts ৳5,000.
        refunded: refundedAmount,
        net: round2(orderTotal - refundedAmount),
    };
};

const fetchOrderRows = async (
    query: SalesReportQuery,
    range: IResolvedRange,
    offset: number,
    limit: number,
): Promise<ISalesOrderRow[]> => {
    const orders = await prisma.order.findMany({
        where: orderWhere(query, range),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit,
        include: {
            customer: { select: { id: true, firstName: true, lastName: true } },
            payments: { select: { amount: true, status: true, method: true } },
            refunds: { select: { amount: true, status: true } },
        },
    });

    return orders.map((order) => {
        const collected = order.payments
            .filter((payment) => SETTLED_PAYMENT_STATUSES.includes(payment.status))
            .filter((payment) => !query.method || payment.method === query.method)
            .reduce((sum, payment) => sum + Number(payment.amount), 0);

        const refunded = order.refunds
            .filter((refund) => refund.status === RefundStatus.COMPLETED)
            .reduce((sum, refund) => sum + Number(refund.amount), 0);

        const orderTotal = round2(Number(order.totalAmount));

        return {
            id: order.id,
            orderNumber: order.orderNumber,
            createdAt: order.createdAt,
            // Customer has firstName/lastName, not a single `name` column.
            customerName:
                [order.customer?.firstName, order.customer?.lastName]
                    .filter(Boolean)
                    .join(" ")
                    .trim() || "—",
            isGuestOrder: order.isGuestOrder,
            status: order.status,
            grossSales: round2(Number(order.subtotal)),
            discount: round2(Number(order.discountAmount)),
            shipping: round2(Number(order.shippingAmount)),
            tax: round2(Number(order.taxAmount)),
            orderTotal,
            collected: round2(collected),
            outstanding: round2(Math.max(0, orderTotal - collected)),
            refunded: round2(refunded),
        };
    });
};

// ------------------------------------------------------------- groupings ---

const groupByDay = async (
    query: SalesReportQuery,
    range: IResolvedRange,
): Promise<ISalesGroupRow[]> => {
    const orders = await prisma.order.findMany({
        where: orderWhere(query, range),
        select: { id: true, createdAt: true, totalAmount: true },
    });

    const settled = await prisma.payment.findMany({
        where: collectedWhere(query, range),
        select: { orderId: true, amount: true },
    });

    const collectedByOrder = new Map<string, number>();
    for (const payment of settled) {
        collectedByOrder.set(
            payment.orderId,
            (collectedByOrder.get(payment.orderId) ?? 0) + Number(payment.amount),
        );
    }

    const byDay = new Map<string, ISalesGroupRow>();
    for (const order of orders) {
        // Bucketed in the store's timezone, so a day boundary in the grouping
        // is the same boundary the range itself was resolved on.
        const key = dayKeyInStoreZone(order.createdAt);
        const entry = byDay.get(key) ?? {
            key,
            label: key,
            orderCount: 0,
            quantity: null,
            orderTotal: 0,
            collected: 0,
        };
        entry.orderCount += 1;
        entry.orderTotal += Number(order.totalAmount);
        entry.collected += collectedByOrder.get(order.id) ?? 0;
        byDay.set(key, entry);
    }

    return [...byDay.values()]
        .map((row) => ({ ...row, orderTotal: round2(row.orderTotal), collected: round2(row.collected) }))
        .sort((a, b) => a.key.localeCompare(b.key));
};

const groupByProduct = async (
    query: SalesReportQuery,
    range: IResolvedRange,
): Promise<ISalesGroupRow[]> => {
    const grouped = await prisma.orderItem.groupBy({
        by: ["productId"],
        where: { order: orderWhere(query, range) },
        _sum: { quantity: true, totalPrice: true },
        _count: true,
    });

    const products = await prisma.product.findMany({
        where: { id: { in: grouped.map((row) => row.productId) } },
        select: { id: true, name: true },
    });
    const nameById = new Map(products.map((product) => [product.id, product.name]));

    return grouped
        .map((row) => ({
            key: row.productId,
            label: nameById.get(row.productId) ?? "(deleted product)",
            orderCount: row._count,
            quantity: Number(row._sum.quantity ?? 0),
            orderTotal: round2(Number(row._sum.totalPrice ?? 0)),
            // Collection is recorded against an order, not a line, so it
            // cannot be split across products without inventing an allocation.
            collected: 0,
        }))
        .sort((a, b) => b.orderTotal - a.orderTotal);
};

/**
 * Grouped by each product's PRIMARY category (`Product.categoryId`) only.
 *
 * A product may also be tagged into further categories through
 * ProductCategory, but counting its revenue once per tagged category would
 * make the group total exceed the report total — the one thing
 * `admin-reporting/sales-reports` forbids ("the product's revenue is not
 * counted twice in the report total"). Products with no primary category are
 * grouped under an explicit "Uncategorised" row rather than dropped.
 */
const groupByCategory = async (
    query: SalesReportQuery,
    range: IResolvedRange,
): Promise<ISalesGroupRow[]> => {
    const items = await prisma.orderItem.findMany({
        where: { order: orderWhere(query, range) },
        select: {
            quantity: true,
            totalPrice: true,
            product: { select: { categoryId: true, category: { select: { name: true } } } },
        },
    });

    const byCategory = new Map<string, ISalesGroupRow>();
    for (const item of items) {
        const key = item.product?.categoryId ?? "uncategorised";
        const label = item.product?.category?.name ?? "Uncategorised";
        const entry = byCategory.get(key) ?? {
            key,
            label,
            orderCount: 0,
            quantity: 0,
            orderTotal: 0,
            collected: 0,
        };
        entry.orderCount += 1;
        entry.quantity = (entry.quantity ?? 0) + item.quantity;
        entry.orderTotal += Number(item.totalPrice);
        byCategory.set(key, entry);
    }

    return [...byCategory.values()]
        .map((row) => ({ ...row, orderTotal: round2(row.orderTotal) }))
        .sort((a, b) => b.orderTotal - a.orderTotal);
};

/**
 * Grouped by the method money actually arrived through.
 *
 * Orders with no settled payment are not dropped — they appear under an
 * explicit "Not yet paid" group, which is what makes the group totals still
 * add up to the report's order total.
 */
const groupByMethod = async (
    query: SalesReportQuery,
    range: IResolvedRange,
): Promise<ISalesGroupRow[]> => {
    const orders = await prisma.order.findMany({
        where: orderWhere(query, range),
        select: {
            id: true,
            totalAmount: true,
            payments: { select: { amount: true, status: true, method: true } },
        },
    });

    const byMethod = new Map<string, ISalesGroupRow>();
    const entryFor = (key: string, label: string) => {
        const existing = byMethod.get(key);
        if (existing) return existing;
        const created: ISalesGroupRow = {
            key,
            label,
            orderCount: 0,
            quantity: null,
            orderTotal: 0,
            collected: 0,
        };
        byMethod.set(key, created);
        return created;
    };

    for (const order of orders) {
        const settled = order.payments.filter((payment) =>
            SETTLED_PAYMENT_STATUSES.includes(payment.status),
        );

        if (settled.length === 0) {
            const unpaid = entryFor("UNPAID", "Not yet paid");
            unpaid.orderCount += 1;
            unpaid.orderTotal += Number(order.totalAmount);
            continue;
        }

        // Two separate attributions, so neither can double-count:
        //   `collected` follows the money — each settled payment adds its own
        //   amount to its own method.
        for (const payment of settled) {
            entryFor(payment.method, payment.method).collected += Number(payment.amount);
        }

        //   `orderCount` and `orderTotal` follow the ORDER, credited once to
        //   the method that brought in the most of it. An order settled across
        //   two methods is therefore counted exactly once, which is what keeps
        //   the group totals summing to the report total.
        const dominant = settled.reduce((best, payment) =>
            Number(payment.amount) > Number(best.amount) ? payment : best,
        );
        const dominantEntry = entryFor(dominant.method, dominant.method);
        dominantEntry.orderCount += 1;
        dominantEntry.orderTotal += Number(order.totalAmount);
    }

    return [...byMethod.values()]
        .map((row) => ({ ...row, orderTotal: round2(row.orderTotal), collected: round2(row.collected) }))
        .sort((a, b) => b.orderTotal - a.orderTotal);
};

const fetchGroups = (
    query: SalesReportQuery,
    range: IResolvedRange,
): Promise<ISalesGroupRow[]> | null => {
    switch (query.groupBy) {
        case "day":
            return groupByDay(query, range);
        case "product":
            return groupByProduct(query, range);
        case "category":
            return groupByCategory(query, range);
        case "method":
            return groupByMethod(query, range);
        default:
            return null;
    }
};

export interface ISalesReportResult
    extends IReportEnvelope<ISalesOrderRow, ISalesReportSummary> {
    groups: ISalesGroupRow[] | null;
    groupBy: SalesReportQuery["groupBy"] | null;
}

export const getSalesReport = async (query: SalesReportQuery): Promise<ISalesReportResult> => {
    const range = resolveRange(query.from, query.to);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [summary, rows, groups] = await Promise.all([
        fetchSummary(query, range),
        fetchOrderRows(query, range, (page - 1) * limit, limit),
        fetchGroups(query, range) ?? Promise.resolve(null),
    ]);

    return {
        range,
        summary,
        rows,
        groups,
        groupBy: query.groupBy ?? null,
        meta: {
            page,
            limit,
            total: summary.orderCount,
            totalPages: Math.ceil(summary.orderCount / limit),
        },
    };
};

/** Also exported for the payment-method breakdown reused by the payments report's method options. */
export const fetchSalesReportBatch = (
    query: SalesReportQuery,
    offset: number,
    limit: number,
): Promise<ISalesOrderRow[]> =>
    fetchOrderRows(query, resolveRange(query.from, query.to), offset, limit);

/** Exposed so `verify-report-parity.ts` can assert the dashboard and this report agree. */
export const salesRevenueForRange = async (from: string, to: string): Promise<number> => {
    const range = resolveRange(from, to);
    const result = await prisma.order.aggregate({
        where: { ...SALES_ORDER_WHERE, createdAt: { gte: range.start, lte: range.end } },
        _sum: { totalAmount: true },
    });
    return round2(Number(result._sum.totalAmount ?? 0));
};
