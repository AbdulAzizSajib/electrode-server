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
    /**
     * Selling prices this line proposes for the item, applied by a goods
     * receipt rather than on save. Both optional and independently so: absent
     * means "this line has no opinion about that price", which is what every
     * line written before these fields existed means.
     *
     * THE ABOVE-COST RULE IS DELIBERATELY NOT ENFORCED HERE. Whether a staged
     * price clears the item's cost depends on the LANDED cost the receipt will
     * compute — which depends on the order's header shipping and tax spread
     * across every other line — so it is not knowable from this payload. That
     * makes it a transactional service invariant, and the service's specified
     * answer is to warn rather than refuse (a receipt records goods that have
     * physically arrived and must not be rejected to protect a price). It also
     * would refuse the legitimate case: a merchant staging a loss-leader.
     *
     * See openspec/changes/add-purchase-order-pricing, design.md Decision 6.
     */
    stagedOfferPrice: z.number().nonnegative().optional(),
    stagedSellingPrice: z.number().nonnegative().optional(),
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

const amendPurchaseOrderItemZodSchema = purchaseOrderItemZodSchema.extend({
    /** Present for an existing line; absent adds a new one. */
    id: z.string().optional(),
});

export const amendPurchaseOrderZodSchema = z.object({
    items: z.array(amendPurchaseOrderItemZodSchema).min(1),
});

const receivePurchaseOrderItemZodSchema = z.object({
    purchaseOrderItemId: z.string(),
    quantity: z.number().int().positive(),
});

export const receivePurchaseOrderZodSchema = z.object({
    warehouseId: z.string(),
    items: z.array(receivePurchaseOrderItemZodSchema).min(1),
});
