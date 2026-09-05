import {
    IPaymentReportRow,
    IPurchaseReportRow,
    ISalesOrderRow,
    IStockHistoryRow,
    IStockReportRow,
} from "./report.interface";
import { ICsvColumn } from "./report.csv";

/**
 * CSV column sets, one per report.
 *
 * Deliberately mirror the on-screen columns and their order: the export must
 * answer the same question as the screen, and a merchant comparing a row
 * against the page should find the same values in the same sequence
 * (`admin-reporting/report-shell`).
 *
 * Amounts are passed through as numbers, never pre-formatted — report.csv.ts
 * emits them as bare decimals so a spreadsheet reads the column as numeric.
 *
 * That holds even now that the merchant configures how money is written
 * (symbol, its side, decimal places — see utils/formatMoney.ts). This is the
 * one place that formatting is deliberately NOT applied: `formatMoney` exists
 * for messages a human reads, and running a CSV column through it would attach
 * a symbol and thousands separators, turning a column a merchant can sum into
 * one they cannot. The screen and the export answer the same question; they do
 * not have to render the answer the same way.
 */

export const STOCK_COLUMNS: ICsvColumn<IStockReportRow>[] = [
    { header: "Item", value: (row) => row.itemName },
    { header: "SKU", value: (row) => row.sku },
    { header: "On hand", value: (row) => row.onHand },
    { header: "Reserved", value: (row) => row.reserved },
    { header: "Available", value: (row) => row.available },
    { header: "Low stock threshold", value: (row) => row.lowStockThreshold },
    { header: "Low stock", value: (row) => row.isLowStock },
    { header: "Cost price", value: (row) => row.costPrice },
    { header: "Cost value", value: (row) => row.costValue },
    { header: "Selling price", value: (row) => row.price },
    { header: "Retail value", value: (row) => row.retailValue },
    { header: "Cached quantity", value: (row) => row.cachedQuantity },
    { header: "Quantity mismatch", value: (row) => row.hasQuantityMismatch },
    {
        header: "Warehouses",
        value: (row) =>
            row.warehouses.map((w) => `${w.warehouseName}: ${w.quantity}`).join("; "),
    },
];

export const STOCK_HISTORY_COLUMNS: ICsvColumn<IStockHistoryRow>[] = [
    { header: "Date", value: (row) => row.createdAt },
    { header: "Product", value: (row) => row.productName },
    { header: "Variant", value: (row) => row.variantName },
    { header: "Warehouse", value: (row) => row.warehouseName },
    { header: "Type", value: (row) => row.type },
    { header: "Change", value: (row) => row.quantity },
    { header: "Balance", value: (row) => row.balance },
    { header: "Reference", value: (row) => row.referenceId },
    { header: "Note", value: (row) => row.note },
];

export const SALES_COLUMNS: ICsvColumn<ISalesOrderRow>[] = [
    { header: "Order number", value: (row) => row.orderNumber },
    { header: "Date", value: (row) => row.createdAt },
    { header: "Customer", value: (row) => row.customerName },
    { header: "Guest", value: (row) => row.isGuestOrder },
    { header: "Status", value: (row) => row.status },
    { header: "Gross sales", value: (row) => row.grossSales },
    { header: "Discount", value: (row) => row.discount },
    { header: "Shipping", value: (row) => row.shipping },
    { header: "Tax", value: (row) => row.tax },
    { header: "Order total", value: (row) => row.orderTotal },
    { header: "Collected", value: (row) => row.collected },
    { header: "Outstanding", value: (row) => row.outstanding },
    { header: "Refunded", value: (row) => row.refunded },
];

export const PURCHASE_COLUMNS: ICsvColumn<IPurchaseReportRow>[] = [
    { header: "Purchase number", value: (row) => row.purchaseNumber },
    { header: "Date", value: (row) => row.createdAt },
    { header: "Supplier", value: (row) => row.supplierName },
    { header: "Supplier active", value: (row) => row.supplierIsActive },
    { header: "Status", value: (row) => row.status },
    { header: "Quantity ordered", value: (row) => row.quantityOrdered },
    { header: "Quantity received", value: (row) => row.quantityReceived },
    { header: "Quantity outstanding", value: (row) => row.quantityOutstanding },
    { header: "Subtotal", value: (row) => row.subtotal },
    { header: "Shipping", value: (row) => row.shippingCost },
    { header: "Tax", value: (row) => row.taxAmount },
    { header: "Purchase value", value: (row) => row.purchaseValue },
    { header: "Amount paid", value: (row) => row.amountPaid },
    { header: "Balance owed", value: (row) => row.balanceOwed },
    { header: "Settlement", value: (row) => row.settlementState },
];

export const PAYMENT_COLUMNS: ICsvColumn<IPaymentReportRow>[] = [
    { header: "Date", value: (row) => row.effectiveDate },
    { header: "Direction", value: (row) => (row.direction === "IN" ? "Money in" : "Money out") },
    { header: "Counterparty", value: (row) => row.counterpartyName },
    { header: "Guest", value: (row) => row.isGuest },
    { header: "Document", value: (row) => row.documentNumber },
    { header: "Method", value: (row) => row.method },
    { header: "Status", value: (row) => row.status },
    { header: "Settled", value: (row) => row.isSettled },
    { header: "Amount", value: (row) => row.amount },
    { header: "Reference", value: (row) => row.reference },
];
