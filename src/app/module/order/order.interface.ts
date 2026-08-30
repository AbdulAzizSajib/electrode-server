/**
 * Who is checking out. A discriminated union rather than an optional
 * `userId`, so "neither a session nor a guest identity" is unconstructible
 * instead of being a runtime guard buried in the middle of checkout — and so
 * TypeScript flags any branch that forgets one of the two cases.
 */
export type ICheckoutActor =
    | { kind: "user"; userId: string }
    | {
          kind: "guest";
          /** From the `guestToken` cookie; absent when the guest never touched the cart. */
          guestToken?: string;
          /** Client address, recorded on the order to back the per-IP rate limit. */
          ip: string;
      };

/** A shipping address supplied inline, as a guest has none saved to reference. */
export interface IGuestAddressPayload {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state?: string;
    postalCode?: string;
    country?: string;
}

/** One line of a cart-less checkout. Price and name are resolved server-side. */
export interface ICheckoutItemPayload {
    productId: string;
    variantId?: string;
    quantity: number;
}

export interface ICreateOrderPayload {
    shippingAddressId?: string;
    shippingMethodId?: string;
    notes?: string;

    /** Guest checkout only: contact details, since a guest has no account to read them from. */
    fullName?: string;
    phone?: string;
    /** Guest checkout only: the delivery address, supplied inline. */
    shippingAddress?: IGuestAddressPayload;
    /**
     * Optional cart bypass. When present these lines are ordered directly and
     * the cart is left untouched — a campaign landing page can turn one
     * product into an order without a prior add-to-cart round trip. Prices and
     * stock are still resolved from the database; nothing here is trusted.
     */
    items?: ICheckoutItemPayload[];
    /** Guest checkout is cash-on-delivery only; anything else is rejected. */
    paymentMethod?: string;
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
