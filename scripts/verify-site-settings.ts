/**
 * Verification for the Checkout Setting / Site Setting change.
 *
 * Covers the two places where a bad value would be actively dangerous rather
 * than merely wrong:
 *
 *  - the Google Fonts parser, whose output is interpolated into a `<link href>`
 *    and a `font-family` on every storefront page, and
 *  - the checkout config's invariants, which are what stop a merchant from
 *    saving a checkout nobody can complete or one whose orders cannot be
 *    tracked.
 *
 * Pure functions only — no database, no network. Run with:
 *   npx tsx scripts/verify-site-settings.ts
 */
import { parseGoogleFontEmbed } from "../src/app/module/store-setting/google-font";
import {
    checkoutConfigSchema,
    checkoutConfigUpdateSchema,
    themeSchema,
    SITE_CONTENT_WIDTHS,
} from "../src/app/module/store-setting/store-setting.validation";
import {
    DEFAULT_CHECKOUT_CONFIG,
    DEFAULT_THEME,
} from "../src/app/module/store-setting/store-setting.constant";
import {
    collectMissingCheckoutFields,
    missingCheckoutFieldsMessage,
    submittedCheckoutFields,
} from "../src/app/module/order/order.checkout-fields";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Asserts the parser accepts `input` and yields exactly `family` and `url`. */
const accepts = (label: string, input: string, family: string, url: string) => {
    const result = parseGoogleFontEmbed(input);
    if (!result.ok) {
        check(label, false, `rejected: ${result.message}`);
        return;
    }
    check(
        label,
        result.value.family === family && result.value.url === url,
        `family "${result.value.family}", url ${result.value.url}`,
    );
};

/** Asserts the parser refuses `input`, and reports the message it gave. */
const rejects = (label: string, input: string) => {
    const result = parseGoogleFontEmbed(input);
    check(label, !result.ok, result.ok ? `ACCEPTED ${result.value.url}` : `"${result.message}"`);
};

const OUTFIT_URL =
    "https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap";

console.log("\n--- Google Fonts parser: accepted paste forms ---\n");

accepts(
    "@import rule",
    '@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap");',
    "Outfit",
    OUTFIT_URL,
);
accepts(
    "<link> tag",
    '<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap" rel="stylesheet">',
    "Outfit",
    OUTFIT_URL,
);
accepts("bare URL", OUTFIT_URL, "Outfit", OUTFIT_URL);

accepts(
    "multi-word family decodes + to space",
    "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap",
    "Open Sans",
    "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap",
);
accepts(
    "legacy /css endpoint",
    "https://fonts.googleapis.com/css?family=Roboto",
    "Roboto",
    "https://fonts.googleapis.com/css?family=Roboto&display=swap",
);
accepts(
    "display is forced to swap",
    "https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=block",
    "Outfit",
    OUTFIT_URL,
);

console.log("\n--- Google Fonts parser: rejections ---\n");

rejects("non-Google host", '@import url("https://evil.test/css2?family=Outfit");');
rejects(
    "lookalike host (suffix attack)",
    "https://fonts.googleapis.com.evil.test/css2?family=Outfit:wght@400",
);
rejects("http:// URL", "http://fonts.googleapis.com/css2?family=Outfit:wght@400");
rejects("no URL at all", "Outfit, sans-serif");
rejects("empty input", "   ");
rejects("Google URL that is not a stylesheet", "https://fonts.googleapis.com/icon?family=Material");
rejects("no family parameter", "https://fonts.googleapis.com/css2?display=swap");
// Percent-encoded, so it survives the URL matcher and reaches the family
// validator with the quote and semicolon intact — which is where it must die.
rejects(
    "family carrying an encoded quote breakout",
    "https://fonts.googleapis.com/css2?family=Outfit%22%3Bcolor%3Ared&display=swap",
);
rejects(
    "axis spec carrying an encoded breakout",
    "https://fonts.googleapis.com/css2?family=Outfit:wght%40400%22%3E%3Cscript%3E&display=swap",
);

// The unencoded form is truncated at the quote by the URL matcher, so the
// injection never reaches the parser at all. Accepting it is correct — what
// matters is that nothing dangerous survives into the rebuilt URL.
{
    const result = parseGoogleFontEmbed(
        'https://fonts.googleapis.com/css2?family=Outfit";color:red;--x:"',
    );
    check(
        "unencoded breakout is stripped, not carried through",
        result.ok && !/["';]|color:red/.test(result.value.url),
        result.ok ? result.value.url : `rejected: ${result.message}`,
    );
}

// The URL is rebuilt from validated parts, so a crafted extra parameter is
// dropped rather than carried through into the stored value.
{
    const result = parseGoogleFontEmbed(
        "https://fonts.googleapis.com/css2?family=Outfit:wght@400&evil=%22%3E%3Cscript%3E",
    );
    check(
        "rebuild drops unrecognised query parameters",
        result.ok && !result.value.url.includes("evil") && !result.value.url.includes("script"),
        result.ok ? result.value.url : `rejected: ${result.message}`,
    );
}

// A stored URL must survive a round-trip unchanged — that is what lets the
// admin form resend an untouched font through the same validation path.
{
    const first = parseGoogleFontEmbed(OUTFIT_URL);
    const second = first.ok ? parseGoogleFontEmbed(first.value.url) : null;
    check(
        "stored URL round-trips idempotently",
        Boolean(first.ok && second?.ok && second.value.url === first.value.url),
        first.ok && second?.ok ? second.value.url : "did not re-parse",
    );
}

console.log("\n--- Theme schema ---\n");

check(
    "DEFAULT_THEME validates",
    themeSchema.safeParse({ ...DEFAULT_THEME, font: DEFAULT_THEME.font.url }).success,
    "defaults must always be a legal theme",
);
check(
    "colour carrying an extra declaration is rejected",
    !themeSchema.safeParse({
        ...DEFAULT_THEME,
        font: DEFAULT_THEME.font.url,
        brand: "#fff;position:fixed",
    }).success,
    "a value that could smuggle CSS must not parse",
);
check(
    "named colour is rejected",
    !themeSchema.safeParse({ ...DEFAULT_THEME, font: DEFAULT_THEME.font.url, brand: "red" })
        .success,
    "hex only",
);
for (const width of SITE_CONTENT_WIDTHS) {
    check(
        `maxWidth ${width} is accepted`,
        themeSchema.safeParse({ ...DEFAULT_THEME, font: DEFAULT_THEME.font.url, maxWidth: width })
            .success,
        "one of the offered content widths",
    );
}
check(
    "a width outside the offered set is rejected",
    !themeSchema.safeParse({ ...DEFAULT_THEME, font: DEFAULT_THEME.font.url, maxWidth: 1384 })
        .success,
    "1384 was the old default and is no longer offered — the hero is laid out from this value",
);
check(
    "an arbitrary width is rejected",
    !themeSchema.safeParse({ ...DEFAULT_THEME, font: DEFAULT_THEME.font.url, maxWidth: 4000 })
        .success,
    "the set is closed, not a range",
);
check(
    'maxWidth "full" is accepted',
    themeSchema.safeParse({ ...DEFAULT_THEME, font: DEFAULT_THEME.font.url, maxWidth: "full" })
        .success,
    "the full-width sentinel",
);
check(
    "DEFAULT_THEME.maxWidth is one of the offered widths",
    (SITE_CONTENT_WIDTHS as readonly number[]).includes(DEFAULT_THEME.maxWidth),
    "an unconfigured store must render at a width the form can also show",
);

console.log("\n--- Checkout config invariants ---\n");

const withFields = (overrides: Record<string, { show: boolean; required: boolean }>) => ({
    ...DEFAULT_CHECKOUT_CONFIG,
    fields: { ...DEFAULT_CHECKOUT_CONFIG.fields, ...overrides },
});

check(
    "DEFAULT_CHECKOUT_CONFIG validates",
    checkoutConfigSchema.safeParse(DEFAULT_CHECKOUT_CONFIG).success,
    "defaults must always be a legal config",
);
check(
    "hidden-and-required is rejected",
    !checkoutConfigSchema.safeParse(withFields({ city: { show: false, required: true } })).success,
    "describes a checkout nobody can complete",
);
check(
    "hidden-and-optional is accepted",
    checkoutConfigSchema.safeParse(withFields({ postalCode: { show: false, required: false } }))
        .success,
    "dropping a field entirely is legitimate",
);
check(
    "shown-but-optional is accepted",
    checkoutConfigSchema.safeParse(withFields({ city: { show: true, required: false } })).success,
    "a merchant may stop requiring a city",
);
check(
    "hiding phone is rejected",
    !checkoutConfigSchema.safeParse(withFields({ phone: { show: false, required: false } }))
        .success,
    "order lookup and the COD cap are keyed on it",
);
check(
    "making phone optional is rejected",
    !checkoutConfigSchema.safeParse(withFields({ phone: { show: true, required: false } })).success,
    "same floor",
);
check(
    "unknown field key is rejected",
    !checkoutConfigSchema.safeParse(withFields({ nickname: { show: true, required: false } }))
        .success,
    "strict() — an unknown key is an error, not a silent drop",
);
check(
    "notice longer than 300 characters is rejected",
    !checkoutConfigSchema.safeParse({ ...DEFAULT_CHECKOUT_CONFIG, notice: "x".repeat(301) })
        .success,
    "bounded like the other free-text settings",
);

console.log("\n--- Guest order acceptance (the rule order.service.ts applies) ---\n");

const GUEST_PAYLOAD = {
    fullName: "Rahim Uddin",
    phone: "01712345678",
    shippingAddress: {
        addressLine1: "12 Gulshan Ave",
        addressLine2: "Flat 3B",
        city: "Dhaka",
        postalCode: "1212",
    },
};

/** Runs the real decision function over a payload and a config. */
const missingFor = (
    config: typeof DEFAULT_CHECKOUT_CONFIG,
    payload: Parameters<typeof submittedCheckoutFields>[0],
) => collectMissingCheckoutFields(config, submittedCheckoutFields(payload));

check(
    "a complete guest order is accepted",
    missingFor(DEFAULT_CHECKOUT_CONFIG, GUEST_PAYLOAD).length === 0,
    "nothing missing",
);

{
    // City required (the default) but absent — must be refused, and named.
    const missing = missingFor(DEFAULT_CHECKOUT_CONFIG, {
        ...GUEST_PAYLOAD,
        shippingAddress: { ...GUEST_PAYLOAD.shippingAddress, city: "" },
    });
    check(
        "order missing a REQUIRED field is refused and the field named",
        missing.length === 1 && missing[0] === "city",
        missing.length ? missingCheckoutFieldsMessage(missing) : "accepted",
    );
}

{
    // Same payload, but the merchant has made City optional — must now pass.
    const config = withFields({ city: { show: true, required: false } });
    const missing = missingFor(config, {
        ...GUEST_PAYLOAD,
        shippingAddress: { ...GUEST_PAYLOAD.shippingAddress, city: "" },
    });
    check(
        "order missing an OPTIONAL field is accepted",
        missing.length === 0,
        "city no longer required",
    );
}

{
    const config = withFields({ fullName: { show: false, required: false } });
    const missing = missingFor(config, { ...GUEST_PAYLOAD, fullName: undefined });
    check(
        "order omitting a hidden field is accepted",
        missing.length === 0,
        "name not collected at all",
    );
}

{
    // Whitespace is not a value — " " in a name box must not satisfy it.
    const missing = missingFor(DEFAULT_CHECKOUT_CONFIG, { ...GUEST_PAYLOAD, fullName: "   " });
    check(
        "whitespace does not satisfy a required field",
        missing.length === 1 && missing[0] === "fullName",
        missing.length ? missingCheckoutFieldsMessage(missing) : "accepted",
    );
}

{
    // No shippingAddress object at all, once every address field is optional.
    const config = withFields({
        addressLine1: { show: false, required: false },
        city: { show: false, required: false },
    });
    const missing = missingFor(config, { fullName: "Rahim", phone: "01712345678" });
    check(
        "absent shippingAddress is fine when no address field is required",
        missing.length === 0,
        "address collection turned off entirely",
    );
}

{
    const missing = missingFor(DEFAULT_CHECKOUT_CONFIG, { phone: "01712345678" });
    check(
        "several missing fields are reported in one message",
        missing.length === 3,
        missingCheckoutFieldsMessage(missing),
    );
}

console.log("\n--- Delivery options ---\n");

const withDelivery = (delivery: {
    offersPickup: boolean;
    options: { key: string; label: string; kind: string; price: number; days: number }[];
}) => ({ ...DEFAULT_CHECKOUT_CONFIG, delivery });

const insideDhaka = { key: "inside-dhaka", label: "Inside Dhaka", kind: "DELIVERY", price: 60, days: 2 };
const outsideDhaka = { key: "outside-dhaka", label: "Outside Dhaka", kind: "DELIVERY", price: 120, days: 4 };
const mirpurPickup = { key: "mirpur", label: "Mirpur 10", kind: "PICKUP", price: 0, days: 0 };

check(
    "the two-area list a merchant actually wants is accepted",
    checkoutConfigSchema.safeParse(
        withDelivery({ offersPickup: false, options: [insideDhaka, outsideDhaka] }),
    ).success,
    "Inside Dhaka / Outside Dhaka — the setup the old place-matching model refused",
);
check(
    "two options may share a price",
    checkoutConfigSchema.safeParse(
        withDelivery({
            offersPickup: false,
            options: [insideDhaka, { ...outsideDhaka, price: 60 }],
        }),
    ).success,
    "options are told apart by name, not by cost",
);
check(
    "a duplicate label is rejected",
    !checkoutConfigSchema.safeParse(
        withDelivery({
            offersPickup: false,
            options: [insideDhaka, { ...outsideDhaka, label: "inside dhaka" }],
        }),
    ).success,
    "case-insensitive — a shopper cannot choose between two identical names",
);
check(
    "a duplicate key is rejected",
    !checkoutConfigSchema.safeParse(
        withDelivery({
            offersPickup: false,
            options: [insideDhaka, { ...outsideDhaka, key: "inside-dhaka" }],
        }),
    ).success,
    "the key is what an order references",
);
check(
    "collection on with no pickup point is rejected",
    !checkoutConfigSchema.safeParse(
        withDelivery({ offersPickup: true, options: [insideDhaka, outsideDhaka] }),
    ).success,
    "a shopper choosing collection would be shown an empty list",
);
check(
    "collection on with a pickup point is accepted",
    checkoutConfigSchema.safeParse(
        withDelivery({ offersPickup: true, options: [insideDhaka, mirpurPickup] }),
    ).success,
    "the configuration the toggle exists for",
);
check(
    "collection off while pickup points exist is accepted",
    checkoutConfigSchema.safeParse(
        withDelivery({ offersPickup: false, options: [insideDhaka, mirpurPickup] }),
    ).success,
    "turning collection off must not force a merchant to delete their points",
);
check(
    "an option with no name is rejected",
    !checkoutConfigSchema.safeParse(
        withDelivery({ offersPickup: false, options: [{ ...insideDhaka, label: "  " }] }),
    ).success,
    "a shopper cannot tell an unnamed option apart from any other",
);
check(
    "a negative price is rejected",
    !checkoutConfigSchema.safeParse(
        withDelivery({ offersPickup: false, options: [{ ...insideDhaka, price: -1 }] }),
    ).success,
    "delivery cannot pay the shopper",
);

/*
 * The empty list is legal to STORE and illegal to SAVE. Both directions are
 * checked because the split is load-bearing: the read path parses rows for
 * stores that have never configured delivery, and the write path is what stops
 * a merchant emptying a checkout that was working.
 */
check(
    "an empty option list is accepted by the stored-config schema",
    checkoutConfigSchema.safeParse(withDelivery({ offersPickup: false, options: [] })).success,
    "the state a store that has never configured delivery is in",
);
check(
    "an empty option list is rejected on save",
    !checkoutConfigUpdateSchema.safeParse(withDelivery({ offersPickup: false, options: [] }))
        .success,
    "a merchant deleting their last option is emptying a working checkout",
);
check(
    "a populated list is accepted on save",
    checkoutConfigUpdateSchema.safeParse(
        withDelivery({ offersPickup: false, options: [insideDhaka, outsideDhaka] }),
    ).success,
    "the update schema differs from the stored one in exactly one rule",
);

/*
 * The shape a store configured before delivery moved into this blob is in.
 * It must keep its own field settings rather than being thrown away for the
 * defaults — see `withDeliveryDefault` in store-setting.service.ts.
 */
{
    const { delivery: _delivery, ...legacy } = DEFAULT_CHECKOUT_CONFIG;
    check(
        "a config stored before delivery existed does not parse as-is",
        !checkoutConfigSchema.safeParse(legacy).success,
        "which is exactly why the read path fills the key in before parsing",
    );
    check(
        "filling in the missing key makes it parse",
        checkoutConfigSchema.safeParse({ ...legacy, delivery: DEFAULT_CHECKOUT_CONFIG.delivery })
            .success,
        "the merchant keeps their own field, notice and guest-checkout settings",
    );
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
