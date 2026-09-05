import { getPaymentReport, fetchPaymentReportBatch } from "./report.payments";
import { getPurchaseReport, fetchPurchaseReportBatch } from "./report.purchases";
import { getSalesReport, fetchSalesReportBatch, salesRevenueForRange } from "./report.sales";
import { getStockHistoryReport, fetchStockHistoryBatch } from "./report.stock-history";
import { getStockReport, fetchStockReportBatch } from "./report.stock";

/**
 * Barrel for the five reports. Each lives in its own file because they share a
 * range parser, a CSV writer and a response shape — not a query engine. Five
 * hand-written queries are clearer than one configurable one (design.md —
 * Non-Goals).
 *
 * Every report exposes two entry points:
 *   get<Report>       — a paged page plus whole-result totals, for the screen
 *   fetch<Report>Batch — offset/limit rows only, for the CSV stream
 * Both apply the same filters and the same ordering, which is what makes an
 * export answer the same question as the screen.
 */
export const ReportService = {
    getStockReport,
    fetchStockReportBatch,
    getStockHistoryReport,
    fetchStockHistoryBatch,
    getSalesReport,
    fetchSalesReportBatch,
    getPurchaseReport,
    fetchPurchaseReportBatch,
    getPaymentReport,
    fetchPaymentReportBatch,
    /** Used by scripts/verify-report-parity.ts to assert the dashboard and the sales report agree. */
    salesRevenueForRange,
};
