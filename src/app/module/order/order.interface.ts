export interface ICreateOrderPayload {
    shippingAddressId?: string;
    shippingMethodId?: string;
    notes?: string;
    /** Client's expected total, used as an optimistic price-agreement check against the server-computed total. */
    expectedTotal?: number;
    /**
     * Not accepted from the request body — order.controller.ts injects it
     * from the `appliedCoupon` cookie the cart module set (see
     * coupon.constant.ts), so checkout consumes whatever coupon is applied
     * to the customer's cart without the client having to resend it.
     */
    couponCode?: string;
    /**
     * Not accepted from the request body either — order.controller.ts reads
     * and validates it from the `Idempotency-Key` header. Absent means this
     * checkout forgoes replay protection (see order.validation.ts).
     */
    idempotencyKey?: string;
}

export interface IUpdateOrderStatusPayload {
    status: "PENDING" | "CONFIRMED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "COMPLETED";
    note?: string;
}

export interface IOrderItemData {
    productId: string;
    variantId?: string | null;
    productName: string;
    sku?: string | null;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
}
