import z from "zod";

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
    siteNameAccent: z.string().max(100).optional(),
    aboutText: z.string().max(1000).optional(),
    copyrightText: z.string().max(300).optional(),

    // Storefront presentation (Json columns)
    mainNav: mainNavSchema.optional(),
    footerColumns: footerColumnsSchema.optional(),
    socialLinks: socialLinksSchema.optional(),
    announcementBar: announcementBarSchema.optional(),
    newsletter: newsletterSchema.optional(),
});
