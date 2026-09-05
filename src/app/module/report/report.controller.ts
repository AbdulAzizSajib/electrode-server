import { Request, Response } from "express";
import status from "http-status";
import { AuditAction } from "../../../generated/prisma/client";
import { catchAsync } from "../../shared/catchAsync";
import { sendResponse } from "../../shared/sendResponse";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
    PAYMENT_COLUMNS,
    PURCHASE_COLUMNS,
    SALES_COLUMNS,
    STOCK_COLUMNS,
    STOCK_HISTORY_COLUMNS,
} from "./report.columns";
import { ICsvColumn, exportFilename, streamCsv } from "./report.csv";
import { ReportService } from "./report.service";

/**
 * Every report handler is the same three steps, so they share one: decide
 * whether this is a screen read or an export, and for an export stream the
 * whole filtered result rather than the page.
 *
 * `format=csv` on the same endpoint rather than a parallel /export route, so
 * the export can never answer a subtly different question than the screen
 * (design decision 7).
 */
const handleReport = <TQuery extends { format?: "json" | "csv"; from?: string; to?: string }, TRow>(
    reportName: string,
    options: {
        columns: ICsvColumn<TRow>[];
        getPage: (query: TQuery) => Promise<unknown>;
        fetchBatch: (query: TQuery, offset: number, limit: number) => Promise<TRow[]>;
    },
) =>
    catchAsync(async (req: Request, res: Response) => {
        // Parsed by `validateQuery` on the route, so unknown or malformed
        // filters are a 400 rather than a silently unfiltered result, and the
        // coercions (page/limit to numbers, "true" to booleans) have happened.
        const query = req.validatedQuery as TQuery;

        if (query.format === "csv") {
            // Viewing is not audited; exporting is — an export leaves the
            // system, a page view does not (`admin-reporting/report-shell`).
            await AuditLogService.record(req.user?.userId, AuditAction.EXPORT, "Report", reportName, {
                newData: { report: reportName, filters: req.query },
            });

            await streamCsv(res, {
                filename: exportFilename(reportName, query.from, query.to),
                columns: options.columns,
                fetchBatch: (offset, limit) => options.fetchBatch(query, offset, limit),
            });
            return;
        }

        const result = await options.getPage(query);

        sendResponse(res, {
            httpStatusCode: status.OK,
            success: true,
            message: `${reportName} fetched successfully`,
            data: result,
        });
    });

const getStockReport = handleReport("stock-report", {
    columns: STOCK_COLUMNS,
    getPage: ReportService.getStockReport,
    fetchBatch: ReportService.fetchStockReportBatch,
});

const getStockHistoryReport = handleReport("stock-history", {
    columns: STOCK_HISTORY_COLUMNS,
    getPage: ReportService.getStockHistoryReport,
    fetchBatch: ReportService.fetchStockHistoryBatch,
});

const getSalesReport = handleReport("sales-report", {
    columns: SALES_COLUMNS,
    getPage: ReportService.getSalesReport,
    fetchBatch: ReportService.fetchSalesReportBatch,
});

const getPurchaseReport = handleReport("purchases-report", {
    columns: PURCHASE_COLUMNS,
    getPage: ReportService.getPurchaseReport,
    fetchBatch: ReportService.fetchPurchaseReportBatch,
});

const getPaymentReport = handleReport("payment-history", {
    columns: PAYMENT_COLUMNS,
    getPage: ReportService.getPaymentReport,
    fetchBatch: ReportService.fetchPaymentReportBatch,
});

export const ReportController = {
    getStockReport,
    getStockHistoryReport,
    getSalesReport,
    getPurchaseReport,
    getPaymentReport,
};
