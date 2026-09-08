/**
 * Turns an order into the consignment payload Steadfast accepts, and says
 * precisely why when it cannot.
 *
 * Every rule here exists because the two systems model the same facts
 * differently, and each mismatch has a way of failing silently:
 *
 *  - Phones are stored E.164 (`+8801712345678`) because guest checkout merges
 *    customers on phone; Steadfast wants 11 local digits.
 *  - An address is six columns here and one 250-character string there.
 *  - Money is `Decimal(12,2)`; the COD figure is what is still owed, not the
 *    order total.
 *
 * Mapping never truncates and never guesses. A value that does not fit is a
 * refusal with a reason the operator can act on — see design.md Decision 9.
 */
import { CourierIneligibleReason, ICourierOrderForDispatch } from "./courier.interface";
import { SteadfastOrderPayload } from "./steadfast.client";
import { toLocalPhone } from "../../utils/phone";

/** Steadfast's documented limits. */
export const MAX_ADDRESS_LENGTH = 250;
export const MAX_RECIPIENT_NAME_LENGTH = 100;

/**
 * The shipping address as one line.
 *
 * `country` is deliberately omitted: Steadfast is domestic-only, so it would
 * spend characters against a hard limit to say "Bangladesh" to a Bangladeshi
 * courier. Empty parts are dropped rather than leaving `, ,` gaps.
 *
 * For a landing-page order the delivery zone lives in `state` — that is what
 * that column models for those orders — so it is carried like any other part.
 */
export const composeAddress = (address: {
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state?: string | null;
    postalCode?: string | null;
}): string =>
    [
        address.addressLine1,
        address.addressLine2,
        address.city,
        address.state,
        address.postalCode,
    ]
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
        .join(", ");

/**
 * What the courier must still collect: the order total less everything already
 * recorded as PAID.
 *
 * A fully prepaid order yields 0 — Steadfast accepts that and simply delivers.
 * Clamped at zero so an over-recorded payment can never produce a negative COD,
 * which Steadfast would reject for the whole batch.
 */
export const computeCodAmount = (order: {
    totalAmount: unknown;
    payments: { amount: unknown; status: string }[];
}): number => {
    const total = Number(order.totalAmount);

    const paid = order.payments
        .filter((payment) => payment.status === "PAID")
        .reduce((sum, payment) => sum + Number(payment.amount), 0);

    const outstanding = total - paid;

    // Rounded to two decimals: the subtraction of two Decimal-backed numbers can
    // leave a float artefact, and a cod_amount of 1059.9999999 is not a figure
    // to hand a delivery rider.
    return Math.max(0, Math.round(outstanding * 100) / 100);
};

export type MapResult =
    | { ok: true; payload: SteadfastOrderPayload }
    | { ok: false; reason: CourierIneligibleReason; detail: string };

/**
 * Maps one order, or explains the refusal.
 *
 * `invoice` is `orderNumber`: already unique, already immutable, and already
 * what the printed label's barcode encodes — so a scanned parcel yields the
 * exact string Steadfast knows it by (design Decision 2).
 */
export const mapOrderToConsignment = (order: ICourierOrderForDispatch): MapResult => {
    const address = order.shippingAddress;

    if (!address) {
        return {
            ok: false,
            reason: "NO_SHIPPING_ADDRESS",
            detail: "This order has no shipping address.",
        };
    }

    const rawPhone = address.phone || order.customer.phone;

    if (!rawPhone) {
        return {
            ok: false,
            reason: "INVALID_PHONE",
            detail: "This order has no recipient phone number.",
        };
    }

    const phone = toLocalPhone(rawPhone);

    if (!phone) {
        return {
            ok: false,
            reason: "INVALID_PHONE",
            detail: `"${rawPhone}" is not a Bangladeshi mobile number the courier will accept.`,
        };
    }

    const recipientName =
        address.fullName?.trim() ||
        [order.customer.firstName, order.customer.lastName]
            .filter(Boolean)
            .join(" ")
            .trim();

    if (!recipientName) {
        return {
            ok: false,
            reason: "NO_RECIPIENT_NAME",
            detail: "This order has no recipient name.",
        };
    }

    if (recipientName.length > MAX_RECIPIENT_NAME_LENGTH) {
        return {
            ok: false,
            reason: "NAME_TOO_LONG",
            detail: `The recipient name is ${recipientName.length} characters; the courier allows ${MAX_RECIPIENT_NAME_LENGTH}.`,
        };
    }

    const composed = composeAddress(address);

    if (!composed) {
        return {
            ok: false,
            reason: "NO_SHIPPING_ADDRESS",
            detail: "This order's shipping address is empty.",
        };
    }

    // Refused, never shortened. A truncated address looks plausible, passes the
    // courier's own validation, and delivers the parcel nowhere — discovered a
    // week later, which is the most expensive outcome available here.
    if (composed.length > MAX_ADDRESS_LENGTH) {
        return {
            ok: false,
            reason: "ADDRESS_TOO_LONG",
            detail: `The delivery address is ${composed.length} characters; the courier allows ${MAX_ADDRESS_LENGTH}. Shorten it on the order before dispatching.`,
        };
    }

    return {
        ok: true,
        payload: {
            invoice: order.orderNumber,
            recipient_name: recipientName,
            recipient_phone: phone,
            recipient_address: composed,
            cod_amount: computeCodAmount(order),
            ...(order.notes ? { note: order.notes.slice(0, 500) } : {}),
        },
    };
};
