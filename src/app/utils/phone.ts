/**
 * Bangladeshi mobile numbers in one canonical form.
 *
 * Guest checkout uses `Customer.phone` as its merge key (see the
 * add-guest-cod-checkout change), so the same person typing `01712345678`
 * on one visit and `+8801712345678` on the next has to resolve to the same
 * customer — otherwise the merge quietly fails on a large share of real
 * traffic and every repeat buyer fragments into new customer rows.
 *
 * E.164 (`+8801XXXXXXXXX`) is the canonical form: unambiguous, and already
 * the format SMS gateways expect if phone verification is added later.
 */

/** Operator prefixes in use: Grameenphone, Robi, Banglalink, Teletalk, Airtel, Skitto. */
const BD_MOBILE_PATTERN = /^\+8801[3-9]\d{8}$/;

/**
 * Reduces any of the ways a BD mobile number gets typed to E.164, or returns
 * null when the input is not one. Accepts `01712345678`, `+8801712345678`,
 * `8801712345678`, `001712345678`, and any of those with spaces, hyphens, or
 * parentheses.
 *
 * Returning null rather than throwing keeps this usable both as a validator
 * and as a normalizer — callers that need a hard failure raise their own
 * error with their own message.
 */
export const normalizePhone = (input: string): string | null => {
    // Strip everything a human might type as separators, keeping a leading +.
    const cleaned = input.trim().replace(/[\s\-().]/g, "");

    if (!/^\+?\d+$/.test(cleaned)) {
        return null;
    }

    const digits = cleaned.replace(/^\+/, "");

    // Longest prefix first: "00880" also starts with "0", and "880" is a prefix
    // of nothing else here — testing in any other order strips the wrong number
    // of leading digits and silently yields a different number.
    let national: string;

    if (digits.startsWith("00880")) {
        national = digits.slice(5);
    } else if (digits.startsWith("880")) {
        national = digits.slice(3);
    } else if (digits.startsWith("0")) {
        national = digits.slice(1);
    } else {
        national = digits;
    }

    const candidate = `+880${national}`;

    return BD_MOBILE_PATTERN.test(candidate) ? candidate : null;
};

/** Whether `input` is a recognizable BD mobile number in any accepted form. */
export const isValidPhone = (input: string): boolean => normalizePhone(input) !== null;
