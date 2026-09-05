import z from "zod";
import { parseGoogleFontEmbed } from "./google-font";

/**
 * These schemas are the ONLY thing standing between a malformed nav tree and
 * the database — Postgres does not constrain the shape of a Json column. Every
 * write path must run through them; reads are correspondingly trusted.
 */

// .strict(): without it Zod silently STRIPS unknown keys, so a third-level
// `children` would be dropped rather than rejected — the nesting cap has to be
// an error the admin sees, not a quiet data loss.
const navChildSchema = z
    .object({
        label: z.string().min(1).max(100),
        href: z.string().min(1).max(500),
    })
    .strict();

const navItemSchema = navChildSchema.extend({
    // The child type deliberately has no `children` key of its own, which caps
    // nesting at one level structurally rather than via a runtime depth check —
    // a third level is a parse error, not something to detect later.
    children: z.array(navChildSchema).max(20).optional(),
});

export const mainNavSchema = z.array(navItemSchema).max(20);

export const footerColumnsSchema = z
    .array(
        z.object({
            title: z.string().min(1).max(100),
            // Links are {label, href} objects, never bare strings: a footer link
            // without a target renders dead, which is the bug this replaces.
            links: z.array(navChildSchema).max(20),
        }),
    )
    .max(6);

/** Constrained to the platforms the storefront actually has an icon for. */
export const socialLinksSchema = z
    .array(
        z.object({
            platform: z.enum(["facebook", "instagram", "youtube", "x", "pinterest"]),
            url: z.url("Social link must be a valid URL"),
        }),
    )
    .max(10);

export const announcementBarSchema = z.object({
    // Separate from the content so toggling the bar off does not discard the
    // text an admin would otherwise have to retype to re-enable it.
    enabled: z.boolean(),
    text: z.string().max(300),
    links: z
        .array(
            z.object({
                icon: z.string().max(100).optional(),
                label: z.string().min(1).max(100),
                href: z.string().min(1).max(500),
                /**
                 * Opt-in binding to the store's contact columns. When set, the
                 * storefront renders this link's label and href from
                 * `contactPhone`/`contactEmail` instead of the stored literals,
                 * so the announcement bar and the footer's contact block cannot
                 * drift apart — changing the number in one place changes both.
                 *
                 * `label`/`href` stay required and are kept as the fallback for
                 * a store whose contact column is still empty.
                 */
                source: z.enum(["contactPhone", "contactEmail"]).optional(),
            }),
        )
        .max(6)
        .optional(),
});

export const newsletterSchema = z.object({
    heading: z.string().max(200),
    subtext: z.string().max(500),
    placeholder: z.string().max(100).optional(),
    buttonLabel: z.string().max(50).optional(),
});

/* ------------------------------------------------------------------ *
 * Checkout configuration
 * ------------------------------------------------------------------ */

/**
 * The checkout fields a merchant may configure.
 *
 * These are deliberately the ORDER PAYLOAD's own keys — `fullName`, `phone`,
 * and the four that live under `shippingAddress` — so order.service.ts can
 * validate by iterating this map instead of a switch statement that would have
 * to be kept in step with the admin's table by hand.
 */
export const CHECKOUT_FIELD_KEYS = [
    "fullName",
    "phone",
    "addressLine1",
    "addressLine2",
    "city",
    "postalCode",
] as const;

export type CheckoutFieldKey = (typeof CHECKOUT_FIELD_KEYS)[number];

/** Labels used in the messages the shopper and the merchant actually read. */
export const CHECKOUT_FIELD_LABELS: Record<CheckoutFieldKey, string> = {
    fullName: "Customer name",
    phone: "Mobile number",
    addressLine1: "Address",
    addressLine2: "Apartment, floor",
    city: "City",
    postalCode: "Postal code",
};

// .strict() for the same reason the nav schemas use it: an unknown key must be
// an error the merchant sees, not a field Zod quietly drops.
const checkoutFieldSchema = z
    .object({
        show: z.boolean(),
        required: z.boolean(),
    })
    .strict();

/** Lowercase words joined by single hyphens — the same slug shape landing pages use. */
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * More than this and the checkout is a wall of radio buttons rather than a
 * choice. A shop with dozens of delivery areas is describing a courier's rate
 * card, which is not what this models.
 */
export const MAX_DELIVERY_OPTIONS = 20;

export const DELIVERY_KINDS = ["DELIVERY", "PICKUP"] as const;

/**
 * One delivery choice a shopper picks at checkout.
 *
 * `key` is generated once and never rewritten, so renaming an option does not
 * re-bucket the orders placed under it; `label` is what the shopper reads and
 * what the order captures. Deliberately carries NO destination criteria — the
 * shopper chooses this, it is never derived from the address they typed. See
 * design.md, D1 and D2.
 */
const deliveryOptionSchema = z
    .object({
        key: z
            .string()
            .min(1)
            .max(60)
            .regex(slugPattern, "Delivery option key must be lowercase words separated by single hyphens"),
        label: z.string().trim().min(1, "A delivery option needs a name").max(120),
        kind: z.enum(DELIVERY_KINDS),
        price: z.number().nonnegative().max(1_000_000),
        days: z.number().int().min(0).max(365),
    })
    .strict();

/**
 * The store's delivery choices, and whether collection in person is offered.
 *
 * An EMPTY option list is permitted here on purpose: it is the state a store
 * that has never configured delivery is in, and this same schema parses the
 * stored row on every read. Rejecting it here would make a fresh store's config
 * unparseable and send it to the defaults — which are themselves empty. What an
 * empty list must NOT survive is a merchant SAVE, so that rule lives on the
 * update schema instead; checkout separately refuses to price an order when the
 * list is empty. See the delivery-options spec, "A store with no delivery
 * options cannot take orders".
 */
const deliverySettingsSchema = z
    .object({
        offersPickup: z.boolean(),
        options: z.array(deliveryOptionSchema).max(MAX_DELIVERY_OPTIONS),
    })
    .strict()
    .superRefine((delivery, ctx) => {
        const seenKeys = new Set<string>();
        const seenLabels = new Set<string>();

        delivery.options.forEach((option, index) => {
            if (seenKeys.has(option.key)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["options", index, "key"],
                    message: `Two delivery options share the key "${option.key}"`,
                });
            }
            seenKeys.add(option.key);

            // Compared case-insensitively: "Inside Dhaka" and "inside dhaka"
            // are the same choice to the shopper reading them, and offering
            // both is a choice they cannot express a preference between.
            const label = option.label.toLowerCase();
            if (seenLabels.has(label)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["options", index, "label"],
                    message: `Two delivery options are both named "${option.label}"`,
                });
            }
            seenLabels.add(label);
        });

        // Collection offered with nowhere to collect from is a shopper choosing
        // "I'll pick it up" and then being shown an empty list.
        if (delivery.offersPickup && !delivery.options.some((o) => o.kind === "PICKUP")) {
            ctx.addIssue({
                code: "custom",
                path: ["offersPickup"],
                message:
                    "Collection in person is on but no delivery option is marked as a pickup point — add one, or turn collection off.",
            });
        }
    });

export const checkoutConfigSchema = z
    .object({
        fields: z
            .object({
                fullName: checkoutFieldSchema,
                phone: checkoutFieldSchema,
                addressLine1: checkoutFieldSchema,
                addressLine2: checkoutFieldSchema,
                city: checkoutFieldSchema,
                postalCode: checkoutFieldSchema,
            })
            .strict(),
        showCouponBox: z.boolean(),
        showOrderNote: z.boolean(),
        allowGuestCheckout: z.boolean(),
        notice: z.string().max(300),
        delivery: deliverySettingsSchema,
    })
    .strict()
    .superRefine((config, ctx) => {
        // A field that is required but not rendered describes a checkout no
        // shopper can complete. Caught here rather than at order time, where
        // the merchant would never see it.
        for (const key of CHECKOUT_FIELD_KEYS) {
            const field = config.fields[key];
            if (field.required && !field.show) {
                ctx.addIssue({
                    code: "custom",
                    path: ["fields", key],
                    message: `${CHECKOUT_FIELD_LABELS[key]} cannot be required while it is hidden.`,
                });
            }
        }

        /*
         * The phone floor. Guest order lookup (`/orders/guest`) authorises a
         * read with the order number AND the phone it was placed with, and the
         * per-phone COD cap counts unfulfilled orders by number. An order
         * without a phone can be neither tracked by its owner nor rate-limited,
         * so this is not a merchant decision to make.
         *
         * order.service.ts re-checks the same thing independently, so a row
         * edited straight in the database cannot disable it either.
         */
        if (!config.fields.phone.show || !config.fields.phone.required) {
            ctx.addIssue({
                code: "custom",
                path: ["fields", "phone"],
                message:
                    "Mobile number must stay shown and required — order tracking and the cash-on-delivery limit are both keyed on it.",
            });
        }
    });

/**
 * What a merchant may SAVE, which is narrower than what may be STORED.
 *
 * The one difference is the empty option list. A store that has never
 * configured delivery legitimately has none — that is the state the defaults
 * describe and the state `checkoutConfigSchema` has to keep parsing — but a
 * merchant deleting their last option is emptying a checkout that was working,
 * and that is worth refusing. Splitting the two is what lets both be true.
 */
export const checkoutConfigUpdateSchema = checkoutConfigSchema.superRefine((config, ctx) => {
    if (config.delivery.options.length === 0) {
        ctx.addIssue({
            code: "custom",
            path: ["delivery", "options"],
            message:
                "Add at least one delivery option — a store that takes orders has to be able to say what delivery costs.",
        });
    }
});

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

/**
 * Strict hex, and strict for a reason: these values are interpolated into an
 * inline `style` attribute on the storefront's `<html>`. Anything that could
 * carry a `;` and a second declaration after it has to be unspellable here.
 */
const hexColorSchema = z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex colour such as #0f63b3");

/** The sentinel for "do not constrain the content width at all". */
export const FULL_WIDTH = "full" as const;

/**
 * The content widths a merchant may choose, in pixels. A closed set, not a
 * range — and that is the whole point of it.
 *
 * The homepage hero is laid out proportionally from whatever this value is:
 * every tile carries a fixed aspect ratio and only its pixel size scales, so
 * one uploaded banner fits every option here. A free pixel range put the hero's
 * slider at a shape no artwork was ever cut for — at 1140px it went portrait,
 * at full width it went 2.3:1 — and the banner sat inside empty bands either
 * way. Four widths a merchant picks from cannot produce that.
 */
export const SITE_CONTENT_WIDTHS = [1140, 1280, 1440, 1600] as const;

/** What an unconfigured store runs at. Must match `DEFAULT_THEME.maxWidth`. */
export const DEFAULT_SITE_CONTENT_WIDTH = 1440;

/**
 * How many decimal places a monetary amount may be shown to.
 *
 * 0 covers currencies with no minor unit (JPY, KRW), 2 the overwhelming
 * majority, 3 those with a thousandth unit (KWD, BHD), and 4 is headroom. Above
 * that the digits would be pure noise: money is stored `Decimal(12,2)`, so
 * anything past two decimal places is already trailing zeros.
 */
export const MIN_CURRENCY_DECIMALS = 0;
export const MAX_CURRENCY_DECIMALS = 4;

/**
 * The font arrives as the text the merchant pasted and leaves as the parsed
 * pair. A bare URL is one of the accepted paste forms, which is what lets the
 * admin form send a previously stored URL straight back through this same
 * validation when the merchant did not touch the field — there is no second,
 * unchecked route into the column.
 */
const fontSchema = z.string().min(1).max(2000).transform((input, ctx) => {
    const result = parseGoogleFontEmbed(input);
    if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.message });
        return z.NEVER;
    }
    return result.value;
});

/**
 * Every key is required. The theme is one Json column written whole, so a
 * partial object would silently blank whatever it omitted — a 400 telling the
 * caller to send the complete theme is the better failure.
 */
export const themeSchema = z
    .object({
        background: hexColorSchema,
        foreground: hexColorSchema,
        brand: hexColorSchema,
        brandDark: hexColorSchema,
        accent: hexColorSchema,
        sale: hexColorSchema,
        maxWidth: z.union(
            [z.literal(FULL_WIDTH), z.literal(SITE_CONTENT_WIDTHS)],
            `Content width must be "${FULL_WIDTH}" or one of ${SITE_CONTENT_WIDTHS.join(", ")}px`,
        ),
        font: fontSchema,
    })
    .strict();

export const updateStoreSettingZodSchema = z.object({
    storeName: z.string().min(2).max(200).optional(),
    currency: z.string().min(2).max(10).optional(),
    currencySymbol: z.string().min(1).max(10).optional(),
    currencyPosition: z
        .enum(["BEFORE", "AFTER"], "Symbol position must be BEFORE or AFTER the amount")
        .optional(),
    currencyDecimals: z
        .number()
        .int("Decimal places must be a whole number")
        .min(
            MIN_CURRENCY_DECIMALS,
            `Decimal places must be between ${MIN_CURRENCY_DECIMALS} and ${MAX_CURRENCY_DECIMALS}`,
        )
        .max(
            MAX_CURRENCY_DECIMALS,
            `Decimal places must be between ${MIN_CURRENCY_DECIMALS} and ${MAX_CURRENCY_DECIMALS}`,
        )
        .optional(),
    /*
     * `.nullable()`, unlike every other optional scalar here. Those express
     * "clear this value" by omitting the key, but this column has THREE
     * meaningful states, not two: a threshold, no offer at all (null), and an
     * offer on every order (0). Under a partial upsert an omitted key means
     * "leave unchanged", so without null there is no way to say "withdraw the
     * offer" — which is why a merchant who set a threshold could never unset
     * it. See add-currency-format-and-home-content-cms design.md, Decision 6.
     */
    freeShippingThreshold: z.number().nonnegative().nullable().optional(),
    contactEmail: z.email("Contact email must be valid").optional(),
    contactPhone: z.string().max(30).optional(),
    address: z.string().max(500).optional(),

    // Branding
    logoUrl: z.url("Logo URL must be valid").max(500).optional(),
    footerLogoUrl: z.url("Footer logo URL must be valid").max(500).optional(),
    siteNameAccent: z.string().max(100).optional(),
    aboutText: z.string().max(1000).optional(),
    copyrightText: z.string().max(300).optional(),

    // SEO
    siteUrl: z
        .url("Site URL must be a valid address")
        .max(500)
        .refine(
            (value) => value.startsWith("http://") || value.startsWith("https://"),
            "Site URL must start with http:// or https://",
        )
        .optional(),
    metaTitle: z.string().max(200).optional(),
    metaDescription: z.string().max(500).optional(),

    // Storefront presentation (Json columns)
    mainNav: mainNavSchema.optional(),
    footerColumns: footerColumnsSchema.optional(),
    socialLinks: socialLinksSchema.optional(),
    announcementBar: announcementBarSchema.optional(),
    newsletter: newsletterSchema.optional(),

    // Checkout and theme (Json columns). Optional like everything else here, so
    // the two new admin pages stay as non-clobbering as the existing three
    // editors — a key left out is a column left untouched.
    checkoutConfig: checkoutConfigUpdateSchema.optional(),
    theme: themeSchema.optional(),

    /*
     * The website ↔ single-landing-page toggle and the page it points at.
     *
     * Shape only. The invariants that actually matter — that LANDING_PAGE mode
     * requires a selection, and that the selection must resolve to a PUBLISHED
     * landing page — are NOT here, because they need a database read and
     * `validateRequest` only ever parses `req.body`. They are enforced
     * transactionally in store-setting.service.ts, which is also where the
     * cannot-clear-while-live rule lives.
     *
     * `activeLandingPageId` is `.nullable()` for the same reason
     * `freeShippingThreshold` above is: an omitted key means "leave unchanged"
     * under a partial upsert, so without null there would be no way to say
     * "deselect the page" and a merchant who chose one could never unchoose it.
     */
    siteMode: z
        .enum(["WEBSITE", "LANDING_PAGE"], "Site mode must be WEBSITE or LANDING_PAGE")
        .optional(),
    activeLandingPageId: z.string().min(1).nullable().optional(),
});
