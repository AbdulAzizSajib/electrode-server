import z from "zod";
import { isValidPhone } from "../../utils/phone";
import {
    advanceClaimZodSchema,
    CHECKOUT_PAYMENT_METHODS,
} from "../order/order.validation";
import {
    LANDING_CUSTOM_SECTION_LAYOUTS,
    LANDING_REPEATABLE_SECTION_KEYS,
    LANDING_REQUIRED_SECTION_KEYS,
    LANDING_SECTION_KEYS,
    MAX_CUSTOM_SECTION_BODY,
    MAX_CUSTOM_SECTION_HEADING,
    MAX_CUSTOM_SECTIONS,
    MAX_FAQS,
    MAX_HIGHLIGHTS,
    MAX_MEDIA_ITEMS,
    MAX_ORDER_QUANTITY,
    MAX_PACKAGES,
    MAX_QUOTES,
    MAX_TRUST_BADGES,
    MAX_USAGE_IDEAS,
    MAX_WHY_US,
} from "./landing-page.constant";

/**
 * THE ONLY GATE on LandingPage's Json columns.
 *
 * Postgres cannot constrain a jsonb column's shape, so every invariant those
 * columns carry lives here and nowhere else. Every write must go through these
 * schemas and no code path may persist an unvalidated value — the same contract
 * store-setting.validation.ts holds for StoreSetting's Json columns, stated for
 * the same reason: reads are correspondingly trusted.
 */

/**
 * Lowercase words joined by single hyphens. Identical to Page's rule and to
 * what `slugifyTitle` produces, so an auto-derived slug always passes.
 *
 * Unlike Page's, this is NOT checked against RESERVED_SLUGS: landing pages live
 * under `/offer/<slug>`, a namespace of their own, whereas a Page resolves at the
 * storefront root where it can collide with a real route.
 */
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slugSchema = z
    .string()
    .min(1)
    .max(200)
    .regex(slugPattern, "Slug must be lowercase words separated by single hyphens");

/**
 * Rejected the same way Page's body is: `<p></p>` is what the editor emits for
 * an empty document, and a page published with one is a blank screen between
 * the hero and the order form.
 */
const bodyHtmlSchema = z
    .string()
    .max(200_000)
    .refine(
        (html) => html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() !== "",
        { message: "Description cannot be empty" },
    );

/** Uploaded media lives on our own upload endpoint, but an external URL is allowed. */
const urlSchema = z.string().min(1).max(2000);

const mediaSchema = z
    .array(
        z.object({
            type: z.enum(["IMAGE", "VIDEO"]),
            url: urlSchema,
            thumbnailUrl: urlSchema.optional(),
            alt: z.string().max(300).optional(),
        }),
    )
    .max(MAX_MEDIA_ITEMS);

const highlightsSchema = z
    .array(
        z.object({
            icon: z.string().max(100).optional(),
            title: z.string().min(1).max(200),
            text: z.string().max(600).optional(),
        }),
    )
    .max(MAX_HIGHLIGHTS);

const faqsSchema = z
    .array(
        z.object({
            question: z.string().min(1).max(300),
            answer: z.string().min(1).max(2000),
        }),
    )
    .max(MAX_FAQS);

/**
 * A customer's words — typed out, or shown as the message they actually sent.
 *
 * `text` is OPTIONAL rather than required, which is the whole change here: real
 * campaigns post screenshots of WhatsApp and Messenger replies, and a merchant
 * who has one should not have to retype it into a quote field to use it. A
 * quote must still carry SOMETHING, so the refinement below rejects one with
 * neither text nor image — an empty card is worse than no card.
 *
 * Extends `quotes` rather than adding a sixth list, because a screenshot and a
 * typed quote are the same thing to a shopper, and splitting them would make
 * the merchant choose which section a review belongs in.
 */
const quotesSchema = z
    .array(
        z
            .object({
                name: z.string().min(1).max(120),
                text: z.string().min(1).max(1000).optional(),
                rating: z.number().int().min(1).max(5).optional(),
                photoUrl: urlSchema.optional(),
                /** The review itself as an image — a screenshot of the message. */
                imageUrl: urlSchema.optional(),
            })
            .refine((quote) => Boolean(quote.text?.trim() || quote.imageUrl), {
                message: "A review needs either text or an image",
                path: ["text"],
            }),
    )
    .max(MAX_QUOTES);

/**
 * One tier of a multi-package campaign.
 *
 * `key` is authored once and NEVER rewritten — an order records it, so
 * addressing packages by position would reattach historical orders to a
 * different tier the first time the merchant reordered the list. Same rule as a
 * delivery zone's key.
 *
 * `price` is authored, and is the one price a landing page may write. See the
 * model comment on LandingPage.prisma and design.md Decision 1: it is safe only
 * because `resolveLandingPackage` is the single path the page render, the quote
 * and the order all price through.
 *
 * `compareAtPrice` is the struck-through "was" figure. Refined to be ABOVE the
 * real price — a compare-at below it would advertise a discount that is a price
 * increase, which is the one arithmetic error a shopper is guaranteed to catch.
 */
const packageSchema = z
    .object({
        key: z
            .string()
            .min(1)
            .max(60)
            .regex(slugPattern, "Package key must be lowercase words separated by single hyphens"),
        label: z.string().trim().min(1, "A package needs a name").max(120),
        productId: z.string().min(1, "A package needs a product"),
        price: z.number().nonnegative().max(10_000_000),
        compareAtPrice: z.number().nonnegative().max(10_000_000).optional(),
        /** e.g. "+ ফ্রি ১ কেজি চিনিগুঁড়া চাল" — rendered with the package and in the summary. */
        freeGiftText: z.string().trim().max(200).optional(),
        /** e.g. "হট অফার" — a short highlight ribbon. */
        badge: z.string().trim().max(60).optional(),
        preselected: z.boolean().optional(),
    })
    .strict()
    .refine(
        (pkg) => pkg.compareAtPrice === undefined || pkg.compareAtPrice > pkg.price,
        {
            message: "The struck-through price must be higher than the price being charged",
            path: ["compareAtPrice"],
        },
    );

/**
 * The campaign's tiers.
 *
 * An EMPTY list is valid and means "no packages" — the page falls back to its
 * bound product, which is what every page did before this existed. That is also
 * what makes deleting every package a safe rollback rather than a broken page.
 */
const packagesSchema = z
    .array(packageSchema)
    .max(MAX_PACKAGES)
    .superRefine((packages, ctx) => {
        const seenKeys = new Set<string>();
        let preselectedCount = 0;

        packages.forEach((pkg, index) => {
            if (seenKeys.has(pkg.key)) {
                ctx.addIssue({
                    code: "custom",
                    path: [index, "key"],
                    message: `Two packages share the key "${pkg.key}"`,
                });
            }
            seenKeys.add(pkg.key);

            if (pkg.preselected) preselectedCount += 1;
        });

        /*
         * At most ONE. Two preselected packages describe a page that opens with
         * two things chosen, which the shopper cannot act on and the order
         * cannot resolve — the resolver would have to pick arbitrarily, and
         * whichever it picked would be the one the merchant did not mean.
         */
        if (preselectedCount > 1) {
            ctx.addIssue({
                code: "custom",
                path: [packages.findIndex((p) => p.preselected), "preselected"],
                message: "Only one package can be preselected",
            });
        }
    });

/** Numbered "why we are different" reasons. */
const whyUsSchema = z
    .array(
        z
            .object({
                title: z.string().trim().min(1, "A reason needs a title").max(200),
                text: z.string().trim().max(600).optional(),
            })
            .strict(),
    )
    .max(MAX_WHY_US);

/** "What would I actually do with this" — short labels, optionally with an icon. */
const usageIdeasSchema = z
    .array(
        z
            .object({
                label: z.string().trim().min(1, "A usage idea needs a label").max(120),
                icon: z.string().max(100).optional(),
            })
            .strict(),
    )
    .max(MAX_USAGE_IDEAS);

/**
 * Strict hex, and strict for the same reason store-setting.validation.ts gives:
 * the value is interpolated into an inline `style` attribute on the page's own
 * wrapper, so anything that could carry further declarations is refused here
 * rather than escaped downstream.
 */
const accentColorSchema = z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex colour such as #e18820");

/**
 * The campaign's own look — EVERY colour the page draws, as named tokens.
 *
 * Eight tokens rather than one accent, because one accent could only recolour
 * the handful of brand-coloured elements: the other ninety-odd colours on the
 * page were literal greys typed into components, and no setting could reach
 * them. Named for what they DO rather than what they look like, so a merchant
 * who sets `surfaceAlt` to a pale amber has a page that still makes sense —
 * which `gray50` would not.
 *
 * ALL OPTIONAL, and that is load-bearing. Each token's fallback is declared in
 * the storefront's globals.css as the value the page renders TODAY, and the
 * server sends only what the merchant actually set. So a page that sets nothing
 * is identical to one written before tokens existed, by construction rather
 * than by a default table kept in step by hand.
 *
 * Every value is a STRICT HEX for the reason the accent already was: these
 * reach the page as CSS custom properties in an inline `style` attribute, so a
 * value that could carry further declarations is refused here rather than
 * escaped downstream.
 *
 * `displayFont` mirrors `theme.font`'s shape in store-setting.validation.ts,
 * where the URL is REBUILT from validated components and is never a substring
 * of merchant input. Parsed by the same helper for the same reason.
 *
 * See openspec/changes/add-landing-page-theme-tokens, design.md Decision 2.
 */
const landingThemeSchema = z
    .object({
        /** The campaign's colour: buttons, badges, active states. */
        accent: accentColorSchema.optional(),
        /** A wash of it — band backgrounds and selected-card fills. */
        accentSoft: accentColorSchema.optional(),
        /**
         * What is legible ON the accent, usually white.
         *
         * A token rather than derived from the accent's luminance: that
         * derivation is right most of the time, and the times it is wrong are a
         * white label on a yellow button that nobody can read.
         */
        accentContrast: accentColorSchema.optional(),
        /** The primary content background. */
        surface: accentColorSchema.optional(),
        /** The alternating band background. */
        surfaceAlt: accentColorSchema.optional(),
        /** Body and heading colour. */
        text: accentColorSchema.optional(),
        /**
         * Secondary copy.
         *
         * ONE muted weight, where the components previously used four greys.
         * Keeping four would mean four tokens whose only difference is how grey
         * they are, and a merchant setting all four to shades of their own
         * colour is doing the design system's job by hand. A genuine second
         * weight is expressed as opacity on this token.
         */
        textMuted: accentColorSchema.optional(),
        /** Every rule and card edge. */
        border: accentColorSchema.optional(),
        displayFont: z
            .object({
                family: z.string().trim().min(1).max(120),
                url: urlSchema,
            })
            .strict()
            .optional(),
    })
    .strict();

const trustBadgesSchema = z
    .array(
        z.object({
            icon: z.string().max(100).optional(),
            label: z.string().min(1).max(120),
        }),
    )
    .max(MAX_TRUST_BADGES);


const formFieldSchema = z.object({
    label: z.string().min(1).max(120),
    placeholder: z.string().max(200).optional(),
    helper: z.string().max(300).optional(),
});

/**
 * The order form's authored copy.
 *
 * Note what is NOT here: phone and address have no `required` and no `show`.
 * There is deliberately nowhere in this schema to spell "hide the phone field"
 * or "make the address optional", so no payload can ask for it and no admin
 * screen can accidentally offer it. Phone is what the per-phone COD cap and
 * guest order lookup are keyed on, and address is what a COD parcel is
 * delivered to.
 *
 * `.strict()` is what makes that a guarantee rather than a convention: a
 * payload smuggling `phone: { required: false }` is rejected as an unknown key
 * rather than being quietly dropped, so a merchant or a client that tries gets
 * told no instead of silently getting the default.
 */
const orderFormSchema = z.object({
    heading: z.string().max(200).optional(),
    subheading: z.string().max(400).optional(),
    fields: z.object({
        fullName: formFieldSchema.extend({ required: z.boolean() }).strict(),
        phone: formFieldSchema.strict(),
        address: formFieldSchema.strict(),
    }).strict(),
    submitLabel: z.string().min(1).max(120),
    notice: z.string().max(500).optional(),
});

/**
 * Digits only, and stored as an ID rather than as markup.
 *
 * The storefront writes the pixel bootstrap itself and interpolates this as a
 * JSON-encoded string, so merchant input never reaches the page as a tag, a URL
 * or a script body. This bound is what makes that safe: the same posture
 * theme.font.url takes, where the URL is rebuilt from validated components and
 * is never a substring of merchant input.
 *
 * An empty string is accepted and means "clear it" — a merchant who pastes an
 * id and then thinks better of it must be able to take it back out.
 */
const facebookPixelIdSchema = z
    .string()
    .max(20)
    .refine((value) => value === "" || /^\d{5,20}$/.test(value), {
        message: "Facebook Pixel ID must be digits only",
    });

/**
 * WHICH SECTIONS THE PAGE RENDERS, AND IN WHAT ORDER.
 *
 * ORDER IS THE DATA: this array is stored and read back as sent, never sorted.
 * The position of an entry IS where that section renders.
 *
 * `.strict()` on the entry, for what it costs and buys. An unrecognised field
 * fails the whole save rather than being silently dropped - which means the
 * admin cannot start sending a new field before this schema declares it. That
 * is the correct trade for a column Postgres does not check: a stripped field
 * is one the caller believes it stored.
 *
 * The CUSTOM-only fields are declared on the one entry shape rather than in a
 * discriminated union, which would need a variant per built-in key just to say
 * "none of these four". Which key may carry them is enforced in the refinement
 * below, where the whole entry is visible.
 *
 * See openspec/changes/add-landing-page-section-builder, design.md D6.
 */
export const sectionConfigSchema = z
    .array(
        z
            .object({
                key: z.enum(LANDING_SECTION_KEYS, "Unknown landing page section"),
                enabled: z.boolean(),
                /*
                 * A CUSTOM section's identity, generated by the admin when the
                 * section is created and never rewritten.
                 *
                 * POSITION IS NOT AN IDENTITY: addressing custom sections by
                 * index would reattach a merchant's heading and body to a
                 * different section the first time they dragged one. Same rule
                 * a package's `key` follows, and the same reason.
                 */
                id: z.string().min(1).max(64).optional(),
                heading: z
                    .string()
                    .trim()
                    .min(1)
                    .max(MAX_CUSTOM_SECTION_HEADING)
                    .optional(),
                /*
                 * Merchant-authored HTML, sanitised where it MEETS THE BROWSER
                 * rather than here - exactly the posture `bodyHtml` takes. See
                 * the storefront's lib/sanitize-html.ts.
                 */
                body: z.string().max(MAX_CUSTOM_SECTION_BODY).optional(),
                layout: z.enum(LANDING_CUSTOM_SECTION_LAYOUTS).optional(),
            })
            .strict(),
    )
    .max(
        LANDING_SECTION_KEYS.length + MAX_CUSTOM_SECTIONS + 8,
        "Too many sections on this page",
    )
    .superRefine((sections, ctx) => {
        /*
         * A key appearing twice has no single meaning: the two entries can
         * disagree on `enabled`, and they sit at two positions, so "where does
         * this render" has two answers. Rejected rather than reconciled.
         *
         * CTA AND CUSTOM ARE THE EXCEPTIONS, and they are exceptions to the KEY
         * being the identity rather than to the rule. A page legitimately shows
         * three call-to-action strips and several custom sections - so for CTA
         * the identity is its position, and for CUSTOM it is its `id`.
         *
         * Same arrangement store-setting.validation.ts makes for MID_BANNERS.
         */
        const seenKeys = new Set<string>();
        const seenCustomIds = new Set<string>();
        let customCount = 0;

        sections.forEach((section, index) => {
            const isCustom = section.key === "CUSTOM";
            const repeatable = LANDING_REPEATABLE_SECTION_KEYS.includes(section.key);

            /*
             * The four content fields belong to CUSTOM alone. Rejected on any
             * other key rather than ignored: ignoring stores a field that
             * governs nothing and reads as though it does.
             */
            if (!isCustom) {
                for (const field of ["id", "heading", "body", "layout"] as const) {
                    if (section[field] !== undefined) {
                        ctx.addIssue({
                            code: "custom",
                            path: [index, field],
                            message: `${section.key} is a built-in section, so it cannot carry its own ${field}.`,
                        });
                    }
                }
            }

            if (isCustom) {
                customCount += 1;

                /*
                 * A custom section WITHOUT an id cannot be told from its
                 * siblings, so an edit to one would land on whichever the
                 * matcher happened to find first. Refused here so that never
                 * becomes a silent content swap.
                 */
                if (section.id === undefined) {
                    ctx.addIssue({
                        code: "custom",
                        path: [index, "id"],
                        message:
                            "A custom section must carry its own id. " +
                            "Reload the page and try again if this persists.",
                    });
                } else if (seenCustomIds.has(section.id)) {
                    ctx.addIssue({
                        code: "custom",
                        path: [index, "id"],
                        message: "Two custom sections share one id.",
                    });
                } else {
                    seenCustomIds.add(section.id);
                }

                /* A custom section with no heading AND no body renders nothing. */
                if (!section.heading && !section.body) {
                    ctx.addIssue({
                        code: "custom",
                        path: [index, "heading"],
                        message: "A custom section needs a heading or a body.",
                    });
                }
            }

            if (!repeatable) {
                if (seenKeys.has(section.key)) {
                    ctx.addIssue({
                        code: "custom",
                        path: [index, "key"],
                        message: `${section.key} is listed more than once.`,
                    });
                }
                seenKeys.add(section.key);
            }
        });

        if (customCount > MAX_CUSTOM_SECTIONS) {
            ctx.addIssue({
                code: "custom",
                path: [],
                message: `A landing page may have at most ${MAX_CUSTOM_SECTIONS} custom sections.`,
            });
        }

        /*
         * THE PAGE MUST KEEP WHAT MAKES IT A PAGE.
         *
         * Enforced here as well as hidden in the admin, because the admin is
         * one caller and a warning there is dismissed once. A campaign with no
         * hero is a paid click that can buy nothing, and the ads keep running.
         */
        for (const required of LANDING_REQUIRED_SECTION_KEYS) {
            const present = sections.find((section) => section.key === required);

            if (!present) {
                ctx.addIssue({
                    code: "custom",
                    path: [],
                    message: `The ${required} section cannot be removed from a landing page.`,
                });
            } else if (!present.enabled) {
                ctx.addIssue({
                    code: "custom",
                    path: [sections.indexOf(present), "enabled"],
                    message: `The ${required} section cannot be switched off.`,
                });
            }
        }
    });

export const createLandingPageZodSchema = z.object({
    title: z.string().min(1).max(200),
    slug: slugSchema.optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
    productId: z.string().min(1, "Select the product this landing page sells"),

    headline: z.string().min(1, "Headline is required").max(300),
    /*
     * The two OPTIONAL hero texts. An empty string is accepted and means
     * "clear it", the same spelling `facebookPixelId` uses above.
     *
     * Needed because `.optional()` alone gives a merchant no way to take a
     * badge back off a page: an omitted key means "leave unchanged", so the
     * admin could only ever send a value or say nothing, and a campaign that
     * no longer runs its discount was stuck advertising it. The service turns
     * the empty string into a stored NULL, so the column keeps one spelling of
     * "no badge" rather than two.
     *
     * `.nullable()` would be the other way to say this and is deliberately not
     * used: there is no third state here to justify it, and the CLAUDE.md
     * convention reserves it for columns that genuinely have one.
     */
    subheadline: z.string().max(600).optional(),
    badgeText: z.string().max(120).optional(),
    bodyHtml: bodyHtmlSchema,

    media: mediaSchema.optional(),
    highlights: highlightsSchema.optional(),
    faqs: faqsSchema.optional(),
    quotes: quotesSchema.optional(),
    trustBadges: trustBadgesSchema.optional(),

    /*
     * Offer mechanics. All optional, all absent by default — a page that sets
     * none of them behaves exactly as pages did before this change, which is
     * the property that made the migration backfill-free.
     */
    packages: packagesSchema.optional(),
    whyUs: whyUsSchema.optional(),
    usageIdeas: usageIdeasSchema.optional(),
    offerEndsAt: z.iso.datetime().optional(),
    stopOrdersAtDeadline: z.boolean().optional(),
    scarcityTarget: z.number().int().positive().max(1_000_000).optional(),
    orderPhone: z
        .string()
        .trim()
        .refine(isValidPhone, "Enter a valid Bangladeshi mobile number")
        .optional(),
    /*
     * Whether THIS campaign collects money up front. Only a switch — the
     * accounts are the shop's, and there is deliberately nowhere here to
     * declare one. Whether it may be turned ON at all is checked in the
     * service, which can read the shop's settings; this schema cannot.
     */
    requiresAdvancePayment: z.boolean().optional(),
    theme: landingThemeSchema.optional(),
    /*
     * ABSENT means "leave unchanged" on update, and "never configured" on
     * create - which is the null the storefront resolves to the default order.
     * Deliberately NOT `.nullable()`: there is no third state to express, and a
     * null arriving from a client would be a page asking to forget its own
     * layout. See the `.optional()` vs `.nullable()` convention in CLAUDE.md.
     */
    sectionConfig: sectionConfigSchema.optional(),

    // Optional on create only because the service fills them from the Bangla
    // seed defaults. A page always ends up with both.
    orderForm: orderFormSchema.optional(),

    successHeading: z.string().max(200).optional(),
    successMessage: z.string().max(1000).optional(),

    metaTitle: z.string().max(200).optional(),
    metaDescription: z.string().max(500).optional(),
    ogImageUrl: urlSchema.optional(),
    facebookPixelId: facebookPixelIdSchema.optional(),

    sortOrder: z.number().int().min(0).optional(),
})
    /*
     * STRICT, and the reason is the scarcity counter.
     *
     * The service spreads this payload straight into Prisma, so an unknown key
     * has never reached the database — Zod stripped it. But STRIPPING and
     * REFUSING are different promises: stripped, a client that posts
     * `scarcityTakenCount: 65` gets a 201 and believes it seeded the counter,
     * and the next person to add a column by that name turns a silent no-op
     * into a live lie on a public page.
     *
     * The spec requires that no such field be ACCEPTED, so it is refused by
     * name rather than quietly dropped. See the scarcity requirement in
     * openspec/changes/add-conversion-landing-page-sections.
     */
    .strict();

/**
 * Every field optional — a PATCH that only flips `status` must not have to
 * resend the body and the gallery. `.partial()` over the create schema rather
 * than a hand-typed duplicate, so the two cannot drift.
 */
export const updateLandingPageZodSchema = createLandingPageZodSchema.partial();

/**
 * What the page asks for as the shopper changes quantity or zone.
 *
 * Deliberately carries no prices. The totals are computed from the product's
 * stored price and the zone's stored price; a price arriving from a browser is
 * not an input to what anything costs.
 */
export const landingPageQuoteZodSchema = z.object({
    quantity: z.number().int().positive().max(MAX_ORDER_QUANTITY),
    /*
     * The SHOP's delivery option, resolved by the storefront from the district
     * the shopper chose. A campaign no longer authors delivery prices, so there
     * is no zone key to send.
     */
    deliveryOptionKey: z.string().min(1, "Select where the order is going").max(60),
    /** Where it is going, recorded on the order beside the option it resolved to. */
    destination: z
        .object({
            district: z.string().trim().min(1).max(100),
            area: z.string().trim().min(1).max(100),
        })
        .strict()
        .optional(),
    /*
     * Which tier the shopper picked. Optional: a page with no packages sends
     * none, and a page with packages that sends none resolves to the
     * preselected one. An unknown key is refused by the SERVICE, not here —
     * this schema cannot see which packages the page offers.
     */
    packageKey: z.string().min(1).max(60).optional(),
});

/**
 * The order submission.
 *
 * `fullName` is optional HERE and required-or-not by the page's own
 * `orderForm.fields.fullName.required`, which `validateRequest` cannot read —
 * it only ever parses `req.body`. Requiring it here would reject an order the
 * merchant deliberately configured to be placeable without a name, before the
 * service ever got to apply the real rule. This is the same split the normal
 * checkout makes for its own configurable fields.
 *
 * `phone` and `address` are required at this layer because no configuration can
 * make them otherwise — see orderFormSchema above.
 */
export const placeLandingPageOrderZodSchema = z.object({
    quantity: z.number().int().positive().max(MAX_ORDER_QUANTITY),
    /*
     * The SHOP's delivery option, resolved by the storefront from the district
     * the shopper chose. A campaign no longer authors delivery prices, so there
     * is no zone key to send.
     */
    deliveryOptionKey: z.string().min(1, "Select where the order is going").max(60),
    /** Where it is going, recorded on the order beside the option it resolved to. */
    destination: z
        .object({
            district: z.string().trim().min(1).max(100),
            area: z.string().trim().min(1).max(100),
        })
        .strict()
        .optional(),
    /*
     * Which tier the shopper picked. Optional: a page with no packages sends
     * none, and a page with packages that sends none resolves to the
     * preselected one. An unknown key is refused by the SERVICE, not here —
     * this schema cannot see which packages the page offers.
     */
    packageKey: z.string().min(1).max(60).optional(),

    fullName: z.string().trim().max(200).optional(),
    phone: z.string().refine(isValidPhone, "Please enter a valid Bangladeshi mobile number"),
    address: z.string().trim().min(1, "Delivery address is required").max(500),

    notes: z.string().max(1000).optional(),
    expectedTotal: z.number().nonnegative().optional(),

    /*
     * The advance-payment claim, reusing the ORDER module's own schema rather
     * than declaring a second one — same rules, same messages, one place to
     * change them. Whether this campaign may carry a claim at all is decided in
     * the service, which can read the shop's settings; this schema cannot.
     */
    paymentMethod: z.enum(CHECKOUT_PAYMENT_METHODS).optional(),
    advancePayment: advanceClaimZodSchema.optional(),
});
