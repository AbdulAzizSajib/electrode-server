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
