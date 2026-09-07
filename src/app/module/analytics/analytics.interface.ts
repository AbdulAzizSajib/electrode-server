export type IDashboardRange = "7d" | "30d" | "90d";

export interface ITimeSeriesPoint {
    date: string;
    value: number;
}

export interface IDashboardSummary {
    kpis: {
        totalRevenue: number;
        revenueTrend: number;
        totalOrders: number;
        ordersTrend: number;
        totalCustomers: number;
        lowStockCount: number;
    };
    revenueSeries: ITimeSeriesPoint[];
    ordersSeries: ITimeSeriesPoint[];
    recentOrders: Array<{
        id: string;
        orderNumber: string;
        customerName: string;
        total: number;
        status: string;
        createdAt: string;
    }>;
    lowStockProducts: Array<{
        id: string;
        name: string;
        stockQuantity: number;
        lowStockThreshold: number;
    }>;
}

export interface ITopProduct {
    productId: string;
    name: string;
    quantitySold: number;
    revenue: number;
}

export interface ICategorySales {
    categoryId: string;
    categoryName: string;
    revenue: number;
    orderItemCount: number;
}

export interface IOrderStatusBreakdown {
    status: string;
    count: number;
}

export interface IPaymentBreakdown {
    byMethod: Array<{ method: string; count: number; amount: number }>;
    byStatus: Array<{ status: string; count: number }>;
}

export interface IReturnsRefundsSummary {
    returnsByStatus: Array<{ status: string; count: number }>;
    refundsByStatus: Array<{ status: string; count: number; amount: number }>;
    refundRate: number;
}

/**
 * The "has anything changed?" probe behind the admin panel's live dashboard.
 *
 * Unlike every other interface in this file it is not a report: it is polled
 * every few seconds by each open admin tab, so it stays a handful of indexed
 * counts plus one `MAX(createdAt)`. `lastEventAt` is what the client compares
 * between polls to decide whether the heavier `/analytics/*` reports are worth
 * re-fetching; `latestOrder` is what drives the new-order alert.
 */
export interface IPulse {
    latestOrder: {
        id: string;
        orderNumber: string;
        totalAmount: number;
        createdAt: string;
    } | null;
    orderCount: number;
    pendingOrderCount: number;
    unreadNotificationCount: number;
    lowStockCount: number;
    /** Most recent order timestamp, or null when there are no orders at all. */
    lastEventAt: string | null;
}
