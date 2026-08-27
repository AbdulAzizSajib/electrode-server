import z from "zod";

const purchaseOrderItemZodSchema = z.object({
    productId: z.string(),
    /**
     * Optional, but required in practice for a variable product: stock is held
     * per (warehouse, product, variant) and customer orders deduct against the
     * variant bought, so a PO line without one replenishes stock those orders
     * cannot match.
     */
    variantId: z.string().optional(),
    quantity: z.number().int().positive(),
    unitCost: z.number().nonnegative(),
});

export const createPurchaseOrderZodSchema = z.object({
    supplierId: z.string(),
    shippingCost: z.number().nonnegative().optional(),
    taxAmount: z.number().nonnegative().optional(),
    notes: z.string().max(2000).optional(),
    orderedAt: z.iso.datetime().optional(),
    items: z.array(purchaseOrderItemZodSchema).min(1),
});

export const updatePurchaseOrderZodSchema = z.object({
    shippingCost: z.number().nonnegative().optional(),
    taxAmount: z.number().nonnegative().optional(),
    notes: z.string().max(2000).optional(),
    orderedAt: z.iso.datetime().optional(),
    status: z.enum(["DRAFT", "ORDERED", "CANCELLED"]).optional(),
});

const receivePurchaseOrderItemZodSchema = z.object({
    purchaseOrderItemId: z.string(),
    quantity: z.number().int().positive(),
});

export const receivePurchaseOrderZodSchema = z.object({
    warehouseId: z.string(),
    items: z.array(receivePurchaseOrderItemZodSchema).min(1),
});
