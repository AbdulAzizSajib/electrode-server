import { IResolvedRange } from "./report.range";

/** Every report echoes back the paging it applied, matching the `{ data, meta }` shape QueryBuilder returns elsewhere. */
export interface IReportMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// ---------------------------------------------------------------- stock ----

export interface IStockReportRow {
    productId: string;
    variantId: string | null;
    itemName: string;
    sku: string | null;
    onHand: number;
    reserved: number;
    available: number;
    /** `Product.stockQuantity` / `ProductVariant.stockQuantity` — the denormalized mirror, shown only so a disagreement is visible. */
    cachedQuantity: number;
    /** True when the mirror disagrees with the sum of warehouse stock rows. Always false while a warehouse filter is applied — see report.stock.ts. */
    hasQuantityMismatch: boolean;
    lowStockThreshold: number;
    isLowStock: boolean;
    price: number | null;
    costPrice: number | null;
    /** `onHand × costPrice`, or null when the item has no cost price recorded. Never 0 as a stand-in. */
    costValue: number | null;
    retailValue: number | null;
    warehouses: Array<{ warehouseId: string; warehouseName: string; quantity: number; reserved: number }>;
}

export interface IStockReportSummary {
    itemCount: number;
    totalUnits: number;
    totalCostValue: number;
    totalRetailValue: number;
    lowStockCount: number;
    /** How much stock the cost total could not cover, so `totalCostValue` is never read as complete. */
    unvaluedItemCount: number;
    unvaluedUnitCount: number;
    mismatchedItemCount: number;
}

// -------------------------------------------------------- stock history ----

export interface IStockHistoryRow {
    id: string;
    createdAt: Date;
    type: string;
    quantity: number;
    productId: string;
    productName: string;
    variantId: string | null;
    variantName: string | null;
    warehouseId: string | null;
    warehouseName: string | null;
    note: string | null;
    referenceId: string | null;
    /** Balance after this movement, accumulated forward from `opening`. */
    balance: number;
}

export interface IStockHistorySummary {
    opening: number;
    quantityIn: number;
    quantityOut: number;
    closing: number;
    movementCount: number;
    /**
     * True when a movement-type filter is applied, in which case opening and
     * closing describe the UNFILTERED position and only the listed movements
     * are narrowed — the UI must say so rather than let the four figures read
     * as reconciling with the visible rows.
     */
    isTypeFiltered: boolean;
}

// ---------------------------------------------------------------- sales ----

export interface ISalesReportSummary {
    orderCount: number;
    grossSales: number;
    discount: number;
    shipping: number;
    tax: number;
    orderTotal: number;
    collected: number;
    outstanding: number;
    refunded: number;
    /** `orderTotal − refunded`, stated so the merchant does not subtract by hand. */
    net: number;
}

export interface ISalesGroupRow {
    key: string;
    label: string;
    orderCount: number;
    quantity: number | null;
    orderTotal: number;
    collected: number;
}

export interface ISalesOrderRow {
    id: string;
    orderNumber: string;
    createdAt: Date;
    customerName: string;
    isGuestOrder: boolean;
    status: string;
    grossSales: number;
    discount: number;
    shipping: number;
    tax: number;
    orderTotal: number;
    collected: number;
    outstanding: number;
    refunded: number;
}

// ------------------------------------------------------------ purchases ----

export interface IPurchaseReportRow {
    id: string;
    purchaseNumber: string;
    createdAt: Date;
    supplierId: string;
    supplierName: string;
    supplierIsActive: boolean;
    status: string;
    quantityOrdered: number;
    quantityReceived: number;
    quantityOutstanding: number;
    subtotal: number;
    shippingCost: number;
    taxAmount: number;
    purchaseValue: number;
    amountPaid: number;
    balanceOwed: number;
    settlementState: "UNPAID" | "PARTIALLY_PAID" | "SETTLED";
    receiptState: "AWAITING" | "PARTIAL" | "COMPLETE" | "CANCELLED";
}

export interface IPurchaseReportSummary {
    purchaseOrderCount: number;
    quantityOrdered: number;
    quantityReceived: number;
    purchaseValue: number;
    amountPaid: number;
    balanceOwed: number;
    /** Drafts left out of the money figures, stated so the totals are not read as covering everything listed. */
    excludedDraftCount: number;
    cancelledCount: number;
}

export interface IPurchaseGroupRow {
    key: string;
    label: string;
    purchaseOrderCount: number;
    purchaseValue: number;
    amountPaid: number;
    balanceOwed: number;
}

// ------------------------------------------------------------- payments ----

export interface IPaymentReportRow {
    id: string;
    direction: "IN" | "OUT";
    /** `COALESCE(paidAt, createdAt)` — see design decision 5. */
    effectiveDate: Date;
    /** False when `effectiveDate` fell back to the record date because the payment has not settled. */
    isSettled: boolean;
    amount: number;
    method: string;
    status: string;
    counterpartyId: string | null;
    counterpartyName: string;
    isGuest: boolean;
    documentId: string | null;
    documentNumber: string | null;
    reference: string | null;
}

export interface IPaymentReportSummary {
    moneyIn: number;
    moneyOut: number;
    net: number;
    /** Recorded but not settled — deliberately NOT added to `moneyIn`. */
    pending: number;
    refunded: number;
    inCount: number;
    outCount: number;
}

// ---------------------------------------------------------------- shared ---

export interface IReportEnvelope<TRow, TSummary> {
    range: IResolvedRange | null;
    summary: TSummary;
    rows: TRow[];
    meta: IReportMeta;
}
