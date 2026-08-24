import { OrderStatus, ProductStatus, RefundStatus, ReturnStatus } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import {
    ICategorySales,
    IDashboardRange,
    IDashboardSummary,
    IOrderStatusBreakdown,
    IPaymentBreakdown,
    IReturnsRefundsSummary,
    ITimeSeriesPoint,
    ITopProduct,
} from "./analytics.interface";

const RANGE_DAYS: Record<IDashboardRange, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

/** `0` when there's nothing to compare against, rather than `Infinity`/`NaN` — see design.md Decision 3. */
const computeTrend = (current: number, previous: number): number => {
    if (previous === 0) return 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Shared `range` -> `since` resolution used by every reporting endpoint (design.md Context). */
const resolveSince = (range: IDashboardRange): Date => {
    const days = RANGE_DAYS[range];
    return new Date(Date.now() - days * DAY_MS);
};

/**
 * Computed live from `Order`/`Customer`/`Product` on every call — no persisted analytics
 * data, no caching (see design.md Non-Goals). `range` controls both the KPI/trend window and
 * how many days the two time series cover.
 */
const getDashboardSummary = async (range: IDashboardRange): Promise<IDashboardSummary> => {
    const days = RANGE_DAYS[range];
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    const previousSince = new Date(since.getTime() - days * DAY_MS);

    // One query covers both the current and immediately-preceding window (design.md Decision 1) —
    // cancelled orders don't count as revenue/order activity either way.
    const orders = await prisma.order.findMany({
        where: { status: { not: OrderStatus.CANCELLED }, createdAt: { gte: previousSince } },
        select: { totalAmount: true, createdAt: true },
    });

    const thisWindow = orders.filter((o) => o.createdAt >= since);
    const previousWindow = orders.filter((o) => o.createdAt < since);
    const sumAmount = (rows: typeof orders) => rows.reduce((sum, o) => sum + Number(o.totalAmount), 0);

    const totalRevenue = round2(sumAmount(thisWindow));
    const totalOrders = thisWindow.length;

    const revenueTrend = computeTrend(totalRevenue, round2(sumAmount(previousWindow)));
    const ordersTrend = computeTrend(totalOrders, previousWindow.length);

    // Bucket the already-fetched "this window" orders by day (design.md Decision 2) — no
    // per-day query, no raw SQL date-trunc.
    const revenueSeries: ITimeSeriesPoint[] = [];
    const ordersSeries: ITimeSeriesPoint[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
        const key = dateKey(new Date(now.getTime() - i * DAY_MS));
        const dayOrders = thisWindow.filter((o) => dateKey(o.createdAt) === key);
        revenueSeries.push({ date: key, value: round2(sumAmount(dayOrders)) });
        ordersSeries.push({ date: key, value: dayOrders.length });
    }

    const totalCustomers = await prisma.customer.count();

    // Prisma can't compare two columns (stockQuantity vs lowStockThreshold) in a `where` clause,
    // so the threshold check happens in JS — fetch the minimal field set for in-stock active
    // products and filter/sort here (design.md Decision 5 / Non-Goals: no fabricated trend either).
    const inStockProducts = await prisma.product.findMany({
        where: { status: ProductStatus.ACTIVE, stockQuantity: { gt: 0 } },
        select: { id: true, name: true, stockQuantity: true, lowStockThreshold: true },
    });
    const lowStock = inStockProducts
        .filter((p) => p.stockQuantity <= p.lowStockThreshold)
        .sort((a, b) => a.stockQuantity - b.stockQuantity);

    const recentOrdersRaw = await prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            status: true,
            createdAt: true,
            customer: { select: { firstName: true, lastName: true } },
        },
    });

    return {
        kpis: {
            totalRevenue,
            revenueTrend,
            totalOrders,
            ordersTrend,
            totalCustomers,
            lowStockCount: lowStock.length,
        },
        revenueSeries,
        ordersSeries,
        recentOrders: recentOrdersRaw.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            customerName: `${o.customer.firstName} ${o.customer.lastName ?? ""}`.trim(),
            total: Number(o.totalAmount),
            status: o.status,
            createdAt: o.createdAt.toISOString(),
        })),
        lowStockProducts: lowStock.slice(0, 5).map((p) => ({
            id: p.id,
            name: p.name,
            stockQuantity: p.stockQuantity,
            lowStockThreshold: p.lowStockThreshold,
        })),
    };
};

/**
 * Best-selling products in the window, ranked by quantity sold (design.md Decision 2).
 * Grouping is by `productId`, not variant — matches Non-Goals (no variant-level split).
 */
const getTopProducts = async (range: IDashboardRange): Promise<ITopProduct[]> => {
    const since = resolveSince(range);

    const items = await prisma.orderItem.findMany({
        where: { order: { status: { not: OrderStatus.CANCELLED }, createdAt: { gte: since } } },
        select: {
            productId: true,
            productName: true,
            quantity: true,
            totalPrice: true,
        },
    });

    const byProduct = new Map<string, ITopProduct>();
    for (const item of items) {
        const existing = byProduct.get(item.productId);
        if (existing) {
            existing.quantitySold += item.quantity;
            existing.revenue = round2(existing.revenue + Number(item.totalPrice));
        } else {
            byProduct.set(item.productId, {
                productId: item.productId,
                name: item.productName,
                quantitySold: item.quantity,
                revenue: round2(Number(item.totalPrice)),
            });
        }
    }

    return Array.from(byProduct.values()).sort((a, b) => b.quantitySold - a.quantitySold);
};

/**
 * Revenue/order-item count grouped by each product's primary category (design.md Decision 2).
 * Independent query from `getTopProducts` (design.md Decision 1) — not shared/reused.
 */
const getSalesByCategory = async (range: IDashboardRange): Promise<ICategorySales[]> => {
    const since = resolveSince(range);

    const items = await prisma.orderItem.findMany({
        where: { order: { status: { not: OrderStatus.CANCELLED }, createdAt: { gte: since } } },
        select: {
            totalPrice: true,
            product: { select: { categoryId: true, category: { select: { name: true } } } },
        },
    });

    const byCategory = new Map<string, ICategorySales>();
    for (const item of items) {
        const categoryId = item.product.categoryId;
        const categoryName = item.product.category?.name;
        if (!categoryId || !categoryName) continue; // products without a primary category are excluded

        const existing = byCategory.get(categoryId);
        if (existing) {
            existing.revenue = round2(existing.revenue + Number(item.totalPrice));
            existing.orderItemCount += 1;
        } else {
            byCategory.set(categoryId, {
                categoryId,
                categoryName,
                revenue: round2(Number(item.totalPrice)),
                orderItemCount: 1,
            });
        }
    }

    return Array.from(byCategory.values()).sort((a, b) => b.revenue - a.revenue);
};

/**
 * Order count per `OrderStatus` in the window, via a single `groupBy` (design.md Decision 3).
 * Statuses absent from the result are filled in with `count: 0` per spec.md.
 */
const getOrderStatusBreakdown = async (range: IDashboardRange): Promise<IOrderStatusBreakdown[]> => {
    const since = resolveSince(range);

    const grouped = await prisma.order.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since } },
        _count: true,
    });

    const counts = new Map(grouped.map((g) => [g.status, g._count]));
    return Object.values(OrderStatus).map((status) => ({ status, count: counts.get(status) ?? 0 }));
};

/**
 * Payment counts/amounts grouped by method, and counts grouped by status — two independent
 * `groupBy` calls, since Prisma groups by one dimension set at a time (design.md Decision 4).
 */
const getPaymentBreakdown = async (range: IDashboardRange): Promise<IPaymentBreakdown> => {
    const since = resolveSince(range);
    const where = { createdAt: { gte: since } };

    const [byMethodRaw, byStatusRaw] = await Promise.all([
        prisma.payment.groupBy({ by: ["method"], where, _count: true, _sum: { amount: true } }),
        prisma.payment.groupBy({ by: ["status"], where, _count: true }),
    ]);

    return {
        byMethod: byMethodRaw.map((g) => ({
            method: g.method,
            count: g._count,
            amount: round2(Number(g._sum.amount ?? 0)),
        })),
        byStatus: byStatusRaw.map((g) => ({ status: g.status, count: g._count })),
    };
};

/**
 * Return-request counts by status, refund counts/amounts by status, and a refund rate
 * (distinct refunded orders / total orders in the window), `0` when there are no orders
 * in the window rather than a division error (design.md Decision 5, spec.md).
 */
const getReturnsRefunds = async (range: IDashboardRange): Promise<IReturnsRefundsSummary> => {
    const since = resolveSince(range);
    const where = { createdAt: { gte: since } };

    const [returnsRaw, refundsRaw, totalOrders, refundedOrders] = await Promise.all([
        prisma.returnRequest.groupBy({ by: ["status"], where, _count: true }),
        prisma.refund.groupBy({ by: ["status"], where, _count: true, _sum: { amount: true } }),
        prisma.order.count({ where }),
        prisma.refund.findMany({ where, select: { orderId: true }, distinct: ["orderId"] }),
    ]);

    return {
        returnsByStatus: Object.values(ReturnStatus).map((s) => ({
            status: s,
            count: returnsRaw.find((r) => r.status === s)?._count ?? 0,
        })),
        refundsByStatus: Object.values(RefundStatus).map((s) => {
            const match = refundsRaw.find((r) => r.status === s);
            return { status: s, count: match?._count ?? 0, amount: round2(Number(match?._sum.amount ?? 0)) };
        }),
        refundRate: totalOrders === 0 ? 0 : round2(refundedOrders.length / totalOrders),
    };
};

export const AnalyticsService = {
    getDashboardSummary,
    getTopProducts,
    getSalesByCategory,
    getOrderStatusBreakdown,
    getPaymentBreakdown,
    getReturnsRefunds,
};
