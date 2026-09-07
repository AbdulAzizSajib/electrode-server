export interface IAdjustStockPayload {
    /** Signed delta applied to `Stock.quantity` — positive to increase, negative to decrease. */
    quantityDelta: number;
    note?: string;
}

export interface IReassignStockPayload {
    /**
     * The variant the quantity actually belongs to. Must be a variant of the
     * same product the stock row already holds — moving stock between products
     * is not a correction, it is two separate adjustments.
     */
    variantId: string;
    /** How many units to move. May be fewer than the row holds, when one receipt covered several variants. */
    quantity: number;
    note?: string;
}

export interface ILowStockCheckResult {
    isLowStock: boolean;
    availableQuantity: number;
    lowStockThreshold: number;
}
