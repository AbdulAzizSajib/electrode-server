import { OrderStatus, ProductStatus } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { IDashboardRange, IDashboardSummary, ITimeSeriesPoint } from "./analytics.interface";

const RANGE_DAYS: Record<IDashboardRange, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

/** `0` when there's nothing to compare against, rather than `Infinity`/`NaN` — see design.md Decision 3. */
const computeTrend = (current: number, previous: number): number => {
    if (previous === 0) return 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

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

export const AnalyticsService = {
    getDashboardSummary,
};
