export interface IAdjustStockPayload {
    /** Signed delta applied to `Stock.quantity` — positive to increase, negative to decrease. */
    quantityDelta: number;
    note?: string;
}

export interface ILowStockCheckResult {
    isLowStock: boolean;
    availableQuantity: number;
    lowStockThreshold: number;
}
