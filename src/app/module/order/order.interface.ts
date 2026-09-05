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
    notes?: string;

    /**
     * Which delivery option the shopper chose, by its key.
     *
     * Required for a normal order — the price comes from this and from nothing
     * else. Whether it is a delivery or a collection is a property of the
     * OPTION, not a separate field the client asserts: sending both would let a
     * client claim collection against a delivery price.
     *
     * Optional only because a landing-page order does not have one; those are
     * priced by the page's own zones.
     */
    deliveryOptionKey?: string;

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
 * The three ways a campaign landing page's checkout differs from the shop's.
 *
 * Passed as ONE optional argument to `placeOrder` rather than as three flags on
 * the payload, so it is impossible to reach any of them from a request body:
 * every field here is decided by the landing-page service from stored data, and
 * `createOrderZodSchema` has no idea it exists.
 *
 * Everything NOT listed here is deliberately identical between the two paths —
 * stock deduction, the guest COD abuse caps, the order number, the PENDING COD
 * payment, status history, idempotency and notifications all run through the
 * same core. A second implementation of order creation is the risk this
 * parameter exists to avoid; see add-single-product-landing-page design.md,
 * Decision 3 and Decision 8.
 */
export interface ICheckoutOverrides {
    /**
     * Charged instead of whatever `quoteShipping` would have matched. Read from
     * the landing page's stored delivery zone — never from the request.
     */
    shippingOverride?: { amount: number; label: string };
    /**
     * Skips the shop-wide `checkoutConfig` gate: its six-field requiredness map
     * AND `allowGuestCheckout`.
     *
     * A landing page asks for three fields the config does not describe, so a
     * shop requiring a postal code at its normal checkout would otherwise reject
     * every campaign order for a field the page never showed. `allowGuestCheckout`
     * goes with it because publishing a guest-COD landing page IS the merchant
     * opting into guest ordering for that page — a more specific decision than
     * the shop-wide switch, made later.
     *
     * What this does NOT skip: the phone floor, the guest COD caps, or any
     * stock or pricing check. See the landing page's own required-field rule in
     * landing-page.service.ts.
     */
    bypassCheckoutConfig?: boolean;
    /** Campaign attribution recorded on the resulting order. */
    landingPage?: { id: string; title: string };
}

/**
 * What to price, and under which delivery option.
 *
 * The address is deliberately absent. A quote used to take one because delivery
 * was matched from it, which meant the price moved as the shopper typed; the
 * shopper picks the option now, so the only thing that changes the delivery
 * charge is the choice they make.
 */
export interface IQuoteCheckoutPayload {
    /**
     * Which option to price. The storefront holds the option list already — it
     * arrives with the public settings — so it can always name one.
     */
    deliveryOptionKey: string;
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
