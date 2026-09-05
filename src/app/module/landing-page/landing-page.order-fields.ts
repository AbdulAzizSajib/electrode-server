/**
 * The merchant-configurable half of landing-page order validation.
 *
 * Extracted from landing-page.service.ts for exactly the reason
 * order.checkout-fields.ts was extracted from order.service.ts: the rule that
 * decides whether an order is accepted should be exercisable directly, rather
 * than only through a live submission with a published page, a product, stock
 * and a running server behind it. See scripts/verify-landing-page.ts.
 *
 * This rule is deliberately NOT `collectMissingCheckoutFields`. That one reads
 * the shop-wide `checkoutConfig` — six fields a landing page does not ask for —
 * so a shop whose normal checkout requires a city and a postal code would
 * otherwise reject every campaign order for fields the page never showed.
 */
import type { ILandingPageOrderForm } from "./landing-page.interface";

/** What the submission actually carried, on the form's own field names. */
export interface SubmittedLandingPageFields {
    fullName?: string;
    phone?: string;
    address?: string;
}

/**
 * The required fields the submission left out, in the order the form shows them.
 *
 * Only `fullName` is ever in question. Phone and address are structurally
 * always required — `ILandingPageOrderForm` gives neither a `required` flag, so
 * there is nowhere to say otherwise — and both are re-checked here anyway
 * rather than assumed: phone is what the per-phone COD cap and guest order
 * lookup are keyed on, address is what a courier delivers to, and a payload
 * that reached this function by some path other than the Zod schema must not be
 * able to skip either.
 *
 * Whitespace does not satisfy a required field. " " in a name box is an empty
 * name, and accepting it would put a blank into an address a courier reads —
 * the same rule the normal checkout applies to its own fields.
 */
export const collectMissingLandingPageFields = (
    orderForm: ILandingPageOrderForm,
    submitted: SubmittedLandingPageFields,
): string[] => {
    const missing: string[] = [];

    if (orderForm.fields.fullName.required && !submitted.fullName?.trim()) {
        missing.push(orderForm.fields.fullName.label);
    }

    if (!submitted.phone?.trim()) {
        missing.push(orderForm.fields.phone.label);
    }

    if (!submitted.address?.trim()) {
        missing.push(orderForm.fields.address.label);
    }

    return missing;
};

/** One message naming every missing field, so a shopper fixes them in one pass. */
export const missingLandingPageFieldsMessage = (missing: string[]): string =>
    `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required`;
