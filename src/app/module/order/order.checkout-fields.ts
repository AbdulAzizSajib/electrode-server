/**
 * The merchant-configurable half of guest-order validation.
 *
 * Extracted from order.service.ts so the rule that decides whether an order is
 * accepted can be exercised directly, rather than only through a live checkout
 * with a cart, stock and a running server behind it. See
 * scripts/verify-site-settings.ts.
 */
import {
    CHECKOUT_FIELD_KEYS,
    CHECKOUT_FIELD_LABELS,
} from "../store-setting/store-setting.validation";
import type { ICheckoutConfig, ICheckoutFieldKey } from "../store-setting/store-setting.interface";

/** What the request actually carried, flattened to the config's own field keys. */
export type SubmittedCheckoutFields = Record<ICheckoutFieldKey, string | undefined>;

/**
 * Flattens an order payload onto the config's field keys.
 *
 * The four address fields live under `shippingAddress`, which may be absent
 * entirely once a merchant has made all of them optional — hence the optional
 * chaining rather than a required object.
 */
export const submittedCheckoutFields = (payload: {
    fullName?: string;
    phone?: string;
    shippingAddress?: {
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        postalCode?: string;
    };
}): SubmittedCheckoutFields => ({
    fullName: payload.fullName,
    phone: payload.phone,
    addressLine1: payload.shippingAddress?.addressLine1,
    addressLine2: payload.shippingAddress?.addressLine2,
    city: payload.shippingAddress?.city,
    postalCode: payload.shippingAddress?.postalCode,
});

/**
 * The required fields the request left out, in the config's own order.
 *
 * Whitespace does not satisfy a required field — " " in a name box is an empty
 * name, and accepting it would put a blank into an address the courier reads.
 */
export const collectMissingCheckoutFields = (
    config: ICheckoutConfig,
    submitted: SubmittedCheckoutFields,
): ICheckoutFieldKey[] =>
    CHECKOUT_FIELD_KEYS.filter(
        (key) => config.fields[key].required && !submitted[key]?.trim(),
    );

/** One message naming every missing field, so a shopper fixes them in one pass. */
export const missingCheckoutFieldsMessage = (missing: ICheckoutFieldKey[]): string =>
    `${missing.map((key) => CHECKOUT_FIELD_LABELS[key]).join(", ")} ${
        missing.length === 1 ? "is" : "are"
    } required`;
