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

    /**
     * Whether the shopper wants it delivered or will collect it in person.
     * Defaults to delivery. Collection is only accepted when every matched
     * shipping place offers it, and is charged at those places' pickup price
     * rather than their delivery price.
     */
    deliveryMethod?: "DELIVERY" | "PICKUP";

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

/**
 * What to price, and where to. Everything is optional because a quote is asked
 * for while the shopper is still filling the form in — a partial destination
 * simply matches fewer places, and an unmatched one is reported as
 * undeliverable rather than rejected as invalid.
 */
export interface IQuoteCheckoutPayload {
    /** A saved address, which outranks the inline country/state below. */
    shippingAddressId?: string;
    country?: string;
    state?: string;
    /** Only used for the flat-price fallback when no product carries a rule. */
    shippingMethodId?: string;
    /** Prices these lines instead of the cart, mirroring the checkout bypass. */
    items?: ICheckoutItemPayload[];
    /** Injected by the controller from the applied-coupon cookie, as checkout is. */
    couponCode?: string;
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
