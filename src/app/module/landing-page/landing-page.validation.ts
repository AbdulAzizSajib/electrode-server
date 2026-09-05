import z from "zod";
import { isValidPhone } from "../../utils/phone";
import {
    MAX_DELIVERY_ZONES,
    MAX_FAQS,
    MAX_HIGHLIGHTS,
    MAX_MEDIA_ITEMS,
    MAX_ORDER_QUANTITY,
    MAX_QUOTES,
    MAX_TRUST_BADGES,
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
 * under `/lp/<slug>`, a namespace of their own, whereas a Page resolves at the
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

const quotesSchema = z
    .array(
        z.object({
            name: z.string().min(1).max(120),
            text: z.string().min(1).max(1000),
            rating: z.number().int().min(1).max(5).optional(),
            photoUrl: urlSchema.optional(),
        }),
    )
    .max(MAX_QUOTES);

const trustBadgesSchema = z
    .array(
        z.object({
            icon: z.string().max(100).optional(),
            label: z.string().min(1).max(120),
        }),
    )
    .max(MAX_TRUST_BADGES);

/**
 * The delivery options the page offers, and the prices it will be held to.
 *
 * Three invariants Postgres cannot express, all enforced here:
 *
 *  1. **At least one zone.** A page with no zone can charge no delivery and its
 *     product would be undeliverable — the same rule, for the same reason, that
 *     ShippingRule applies to its places.
 *  2. **Unique keys.** The key is what the browser sends back and what the
 *     server prices by. Two zones sharing one would make which price is charged
 *     depend on array order, which is not something a merchant can see.
 *  3. **Non-negative prices.** A negative delivery charge is a discount hidden
 *     inside a shipping field, and it would subtract from the order total by a
 *     route nothing else in the system can see.
 *
 * Free delivery IS spellable — a zone priced 0. That is different from having no
 * zone, and the distinction is the merchant's to make.
 */
const deliveryZonesSchema = z
    .array(
        z.object({
            key: z
                .string()
                .min(1)
                .max(60)
                .regex(slugPattern, "Zone key must be lowercase words separated by single hyphens"),
            label: z.string().min(1).max(120),
            price: z.number().nonnegative().max(1_000_000),
        }),
    )
    .min(1, "At least one delivery zone is required")
    .max(MAX_DELIVERY_ZONES)
    .refine((zones) => new Set(zones.map((zone) => zone.key)).size === zones.length, {
        message: "Each delivery zone must have a distinct key",
    });

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

export const createLandingPageZodSchema = z.object({
    title: z.string().min(1).max(200),
    slug: slugSchema.optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
    productId: z.string().min(1, "Select the product this landing page sells"),

    headline: z.string().min(1, "Headline is required").max(300),
    subheadline: z.string().max(600).optional(),
    badgeText: z.string().max(120).optional(),
    bodyHtml: bodyHtmlSchema,

    media: mediaSchema.optional(),
    highlights: highlightsSchema.optional(),
    faqs: faqsSchema.optional(),
    quotes: quotesSchema.optional(),
    trustBadges: trustBadgesSchema.optional(),

    // Optional on create only because the service fills them from the Bangla
    // seed defaults. A page always ends up with both.
    deliveryZones: deliveryZonesSchema.optional(),
    orderForm: orderFormSchema.optional(),

    successHeading: z.string().max(200).optional(),
    successMessage: z.string().max(1000).optional(),

    metaTitle: z.string().max(200).optional(),
    metaDescription: z.string().max(500).optional(),
    ogImageUrl: urlSchema.optional(),
    facebookPixelId: facebookPixelIdSchema.optional(),

    sortOrder: z.number().int().min(0).optional(),
});

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
    zoneKey: z.string().min(1, "Select a delivery area"),
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
    zoneKey: z.string().min(1, "Select a delivery area"),

    fullName: z.string().trim().max(200).optional(),
    phone: z.string().refine(isValidPhone, "Please enter a valid Bangladeshi mobile number"),
    address: z.string().trim().min(1, "Delivery address is required").max(500),

    notes: z.string().max(1000).optional(),
    expectedTotal: z.number().nonnegative().optional(),
});
