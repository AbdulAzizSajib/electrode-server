export interface IPurchaseOrderItemInput {
    productId: string;
    /**
     * Which variant this line replenishes. Optional for a simple product;
     * required in practice for a variable one, because stock is held per
     * (warehouse, product, variant) and customer orders deduct against the
     * variant actually bought.
     */
    variantId?: string;
    quantity: number;
    unitCost: number;
}

export interface ICreatePurchaseOrderPayload {
    supplierId: string;
    shippingCost?: number;
    taxAmount?: number;
    notes?: string;
    orderedAt?: string;
    items: IPurchaseOrderItemInput[];
}

export interface IUpdatePurchaseOrderPayload {
    shippingCost?: number;
    taxAmount?: number;
    notes?: string;
    orderedAt?: string;
    /** RECEIVED/PARTIALLY_RECEIVED are server-set only, via receivePurchaseOrder — not settable here. */
    status?: "DRAFT" | "ORDERED" | "CANCELLED";
}

export interface IReceivePurchaseOrderItemInput {
    purchaseOrderItemId: string;
    /** Quantity being received in this receipt (may be less than the remaining unreceived quantity — partial receipt). */
    quantity: number;
}

export interface IReceivePurchaseOrderPayload {
    /**
     * No column on `PurchaseOrder`/`PurchaseOrderItem` records which
     * `Warehouse` a receipt lands in (see prisma/schema/PurchaseOrder.prisma,
     * PurchaseOrderItem.prisma) — the receiving admin supplies it per
     * `api/inventory` spec's "the purchase order's implied warehouse".
     */
    warehouseId: string;
    items: IReceivePurchaseOrderItemInput[];
}
