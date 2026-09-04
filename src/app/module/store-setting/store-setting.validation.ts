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

export const MIN_SITE_MAX_WIDTH = 960;
export const MAX_SITE_MAX_WIDTH = 2560;

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
        maxWidth: z.union([
            z.literal(FULL_WIDTH),
            z
                .number()
                .int()
                .min(
                    MIN_SITE_MAX_WIDTH,
                    `Content width must be at least ${MIN_SITE_MAX_WIDTH}px`,
                )
                .max(MAX_SITE_MAX_WIDTH, `Content width must be at most ${MAX_SITE_MAX_WIDTH}px`),
        ]),
        font: fontSchema,
    })
    .strict();

export const updateStoreSettingZodSchema = z.object({
    storeName: z.string().min(2).max(200).optional(),
    currency: z.string().min(2).max(10).optional(),
    currencySymbol: z.string().min(1).max(10).optional(),
    defaultTaxRatePercent: z.number().min(0).max(100).optional(),
    freeShippingThreshold: z.number().nonnegative().optional(),
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
    checkoutConfig: checkoutConfigSchema.optional(),
    theme: themeSchema.optional(),
});
