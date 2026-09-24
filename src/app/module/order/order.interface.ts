import { OrderChannel } from "../../../generated/prisma/client";

/**
 * Who is checking out. A discriminated union rather than an optional
 * `userId`, so "neither a session nor a guest identity" is unconstructible
 * instead of being a runtime guard buried in the middle of checkout — and so
 * TypeScript flags any branch that forgets one of the cases.
 *
 * `staff` is the third case and the odd one: it has a session, but the session
 * does not belong to the person the order is FOR. An operator recording a sale
 * agreed over WhatsApp is acting on a customer's behalf, which is neither of
 * the other two — treating it as `user` would place the order against the
 * operator's own account, and treating it as `guest` would subject an
 * accountable employee to the anonymous-abuse caps and record the shop's own IP
 * as the customer's.
 *
 * Widening this type rather than adding a flag elsewhere is deliberate: every
 * `switch` on `kind` fails to compile until it accounts for the new case, which
 * is the only reliable way to find the branches that must differ. See
 * add-manual-orders-and-item-images design.md, Decision 1.
 */
export type ICheckoutActor =
    | { kind: "user"; userId: string }
    | {
          kind: "guest";
          /** From the `guestToken` cookie; absent when the guest never touched the cart. */
          guestToken?: string;
          /** Client address, recorded on the order to back the per-IP rate limit. */
          ip: string;
      }
    | {
          kind: "staff";
          /**
           * The operator, recorded on the order as `createdByUserId` and on its
           * opening status-history row. Never read from a request body — the
           * controller takes it from the verified session, so an order cannot
           * claim to have been taken by someone else.
           */
          staffUserId: string;
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

/** Which slice of the order total the shopper sent before it ships. */
export type IAdvancePaymentChoice = "DELIVERY_CHARGE" | "FULL";

/**
 * What the shopper claims about money they have already sent.
 *
 * Deliberately has NO amount. The server derives it from `choice` and the
 * delivery option it resolves, so the figure a human later matches against a
 * bank statement is one the shopper could not name.
 */
export interface IAdvanceClaimPayload {
    choice: IAdvancePaymentChoice;
    /** An id from the merchant's own configured accounts; an unknown one is refused. */
    accountId: string;
    /**
     * The advance the shopper was shown, echoed back as an agreement check.
     * The server computes the real figure regardless; a mismatch means the page
     * went stale after they sent the money, and is refused rather than accepted.
     */
    expectedAdvanceAmount?: number;
    /** The shopper's own number, or the depositor's name/account for a bank transfer. */
    senderIdentifier: string;
    transactionId: string;
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
    /**
     * How the shopper intends to pay. Absent means cash on delivery.
     *
     * Anything other than COD is an ADVANCE method — money the shopper says
     * they have already sent — and is refused unless the merchant has advance
     * payment turned on. It must arrive with `advancePayment` below; the
     * validation schema rejects one without the other.
     */
    paymentMethod?: string;
    /**
     * The advance payment claim, when one is being made.
     *
     * Carries no amount: the server computes that from `choice` and the
     * delivery option it resolves, so a client cannot declare how much it sent.
     * See openspec/changes/add-advance-payment-checkout, design.md Decision 7.
     */
    advancePayment?: IAdvanceClaimPayload;
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
    /**
     * The two things a STAFF-placed order states that no checkout can: where
     * the customer reached the shop, and a price the operator negotiated.
     *
     * Here rather than on `ICreateOrderPayload` for the same reason
     * `shippingOverride` above is: `createOrderZodSchema` has no idea this type
     * exists, so neither field is reachable from any request body. A shopper who
     * could name their own discount would be a shopper who shops for free.
     *
     * `placeManualOrder` fills it from the manual endpoint's own validated
     * payload, which is the only place either value may come from.
     */
    manual?: {
        /** Recorded as `Order.channel`. */
        channel: OrderChannel;
        /**
         * A negotiated reduction and the reason for it, both recorded on the
         * order. Absent when the operator gave no discount.
         *
         * One order-level figure rather than per-line prices: every line stays
         * provably catalog-priced, and the whole negotiation lands in one
         * auditable number. `reason` is not optional — a discount nobody
         * explained is an unexplained hole in the day's takings once the
         * conversation that produced it is gone. See design.md, Decision 4.
         */
        discount?: { amount: number; reason: string };
    };
}

/**
 * What the admin's manual order form sends.
 *
 * Deliberately not `ICreateOrderPayload`: that one describes a SHOPPER'S
 * checkout and carries `shippingAddressId`, `couponCode` and `expectedTotal`,
 * none of which a manual order may use — a staff-placed order types its address
 * in, takes a stated discount rather than a coupon (design.md, Decision 5), and
 * is priced by the quote the operator already saw.
 *
 * `placeManualOrder` maps this onto the checkout core's payload; nothing here
 * reaches `placeOrder` directly.
 */
export interface IManualOrderPayload {
    /** The customer's number — their identity, per the platform's phone-first rule. */
    phone: string;
    fullName?: string;
    shippingAddress: IGuestAddressPayload;
    /** At least one, enforced by the validation schema. No price field, by design. */
    items: ICheckoutItemPayload[];
    deliveryOptionKey: string;
    channel: OrderChannel;
    /** Required whenever `discountAmount` is above zero. */
    discountAmount?: number;
    discountReason?: string;
    notes?: string;
    /**
     * Not accepted from the request body — the controller reads it from the
     * `Idempotency-Key` header, exactly as checkout does. An operator's double
     * click must not send the customer two parcels.
     */
    idempotencyKey?: string;
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
    /**
     * A staff discount to price the order under. Staff actor only — the
     * storefront's quote schema has no such field, so a shopper cannot name
     * their own discount.
     *
     * It exists because the admin's manual order form must show the operator a
     * total before they read it aloud to a customer, and the discount cannot be
     * subtracted from an undiscounted quote afterwards: `allocateDiscount`
     * spreads it across the lines BEFORE tax, so a discounted order's tax is
     * not its undiscounted tax minus anything the client can compute.
     */
    discountAmount?: number;
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
    /**
     * Cost basis at placement — supplier cost, never shown to a customer.
     * Null when the item has none recorded: an unknown cost is not a cost of
     * zero, and anything deriving margin from it must tell the two apart.
     */
    unitCost?: number | null;
}
