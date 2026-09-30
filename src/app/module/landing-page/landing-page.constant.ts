import type { ILandingPageOrderForm } from "./landing-page.interface";

/**
 * What a newly created landing page starts with.
 *
 * These are Bangla because that is what the shopper this feature exists for
 * reads — but note WHAT is being seeded: merchant-editable content, not a
 * locale. Every string here is authored content the merchant may overwrite in
 * the admin panel, so a page rewritten in English is English end to end and no
 * translation layer, locale switch or message catalogue is involved. "Bangladeshi
 * style" is a set of defaults, not a hardcoded language.
 *
 * See the `storefront-cms/landing-pages` spec, "Landing page copy is whatever
 * language the merchant writes".
 */

/** The storefront cache tag for landing page content. */
export const LANDING_PAGES_TAG = "landing-pages";


/**
 * The three-field order form, pre-written.
 *
 * Only `fullName.required` is a switch — phone and address carry no requiredness
 * flag at all, by construction. See ILandingPageOrderForm.
 */
export const DEFAULT_ORDER_FORM: ILandingPageOrderForm = {
    heading: "অর্ডার করতে নিচের ফর্মটি পূরণ করুন",
    subheading: "আপনার তথ্য দিন, পণ্য হাতে পেয়ে টাকা পরিশোধ করুন।",
    fields: {
        fullName: {
            label: "নাম",
            placeholder: "আপনার সম্পূর্ণ নাম",
            required: true,
        },
        phone: {
            label: "মোবাইল নম্বর",
            placeholder: "01XXXXXXXXX",
            helper: "অর্ডার কনফার্ম করতে আমরা এই নম্বরে কল করব।",
        },
        address: {
            label: "ঠিকানা",
            placeholder: "গ্রাম/রোড, থানা, জেলা",
        },
    },
    submitLabel: "অর্ডার কনফার্ম করুন",
    notice: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন।",
};

/** Shown after a successful order when the merchant has authored nothing of their own. */
export const DEFAULT_SUCCESS_HEADING = "ধন্যবাদ! আপনার অর্ডারটি গ্রহণ করা হয়েছে।";
export const DEFAULT_SUCCESS_MESSAGE =
    "আমাদের প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবে। অর্ডার নম্বরটি সংরক্ষণ করুন।";

/**
 * Bounds on the repeating content lists.
 *
 * Not arbitrary: a landing page is one scrollable document, and a merchant who
 * needs forty FAQ rows on it is describing a different page than this one. The
 * bounds also keep a single Json column from growing without limit.
 */
export const MAX_MEDIA_ITEMS = 20;
export const MAX_HIGHLIGHTS = 12;
export const MAX_FAQS = 20;
export const MAX_QUOTES = 20;
export const MAX_TRUST_BADGES = 8;

/**
 * More than this and the package selector is a catalogue, not a choice.
 *
 * A shopper deciding between four tiers is already at the edge of what a single
 * screen can present without scrolling past the price — and a campaign offering
 * eight is a product listing page wearing a landing page's clothes, which is a
 * different thing than this models.
 */
export const MAX_PACKAGES = 6;

/**
 * Bounds on the two grids. Both are read at a glance rather than studied, and a
 * merchant who needs thirty reasons is not writing a landing page.
 */
export const MAX_WHY_US = 12;
export const MAX_USAGE_IDEAS = 16;

/**
 * The most units one landing-page order may carry.
 *
 * Matches the per-line cap the normal checkout already applies
 * (`checkoutItemZodSchema` in order.validation.ts), so a quantity that would be
 * refused in the cart is refused here for the same reason and with the same
 * number.
 */
export const MAX_ORDER_QUANTITY = 100;

/**
 * ─────────────────────────────────────────────────────────────────────────
 * WHICH SECTIONS A CAMPAIGN PAGE IS BUILT FROM.
 *
 * `LANDING_SECTION_KEYS` IS THE DEFAULT RENDER ORDER, not just a set of valid
 * values. A page whose `sectionConfig` is null renders exactly this sequence,
 * which is a faithful transcription of the JSX sequence LandingPageView.tsx
 * rendered before the column existed. Reorder this tuple and every campaign
 * that has never been through the section editor silently restyles — the same
 * hazard StoreSetting's HERO_VARIANT_OPTIONS documents for position 0.
 *
 * See openspec/changes/add-landing-page-section-builder, design.md D1/D4.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const LANDING_SECTION_KEYS = [
    /*
     * The product: gallery, headline, subheadline, price and trust badges.
     *
     * THE KEY KEEPS ITS OLD NAME although it no longer covers the order
     * form. Every sectionConfig stored since the editor shipped names
     * "HERO" for this block, and renaming it would drop that entry on read
     * and refuse it on the next save — losing the merchant's chosen position
     * for a word they never see. What they read is the admin's label, and
     * that says "Product".
     *
     * NOT DISABLEABLE — see LANDING_REQUIRED_SECTION_KEYS below — but
     * reorderable like any other section, including below the order form.
     */
    "HERO",
    /*
     * The order form: the fields, the package picker and the summary.
     *
     * SPLIT OUT OF "HERO", which rendered the two as one block and so could
     * not express "form first" or "form after the reviews" at all. Where the
     * product sits and where the form sits are two decisions, and a merchant
     * moving one almost never means the other.
     *
     * NOT DISABLEABLE either, and for the harder reason of the two: a
     * campaign page with no order form is a paid click that cannot buy.
     */
    "ORDER_FORM",
    /** The countdown and the scarcity meter — both answer "why now". */
    "OFFER",
    /** The benefit cards. */
    "HIGHLIGHTS",
    /** The numbered "why we are different" grid. */
    "WHY_US",
    /** The merchant's own rich-text body. */
    "BODY",
    /** "What would I do with this" — the tile grid. */
    "USAGE_IDEAS",
    /** Customer quotes. */
    "QUOTES",
    /** The FAQ accordion. */
    "FAQS",
    /*
     * A call-to-action strip: one button back to the order form, one to call.
     *
     * THE SECOND KEY THAT MAY REPEAT, and in the default order it appears
     * THREE times — after the highlights, after the usage ideas, and after the
     * FAQ. That repetition is the point: the moment a shopper is convinced is
     * not predictable, and a single button at the bottom asks them to remember
     * they were convinced and scroll to act on it.
     */
    "CTA",
    /*
     * A section the merchant wrote themselves: heading, body and layout.
     *
     * THE OTHER KEY THAT MAY REPEAT, once per custom section, and the only one
     * that carries its own content inside the entry rather than in a column.
     */
    "CUSTOM",
] as const;

export type LandingSectionKey = (typeof LANDING_SECTION_KEYS)[number];

/**
 * The DEFAULT ORDER, including the three call-to-action strips.
 *
 * Transcribed from LandingPageView.tsx as it rendered before this change. It is
 * what a page with a null `sectionConfig` resolves to, so it is the definition
 * of "unchanged" for every campaign that exists today — the single thing the
 * verify script pins hardest.
 */
export const DEFAULT_LANDING_SECTION_ORDER: readonly LandingSectionKey[] = [
    "HERO",
    "ORDER_FORM",
    "OFFER",
    "HIGHLIGHTS",
    "CTA",
    "WHY_US",
    "BODY",
    "USAGE_IDEAS",
    "CTA",
    "QUOTES",
    "FAQS",
    "CTA",
] as const;

/**
 * The keys that may appear MORE THAN ONCE in a stored order.
 *
 * Named rather than written as a literal at each place that branches on it:
 * every one of those is somewhere that treating repeats as a single section
 * silently merges them. Anything matching entries must match on `key` + `id`
 * for CUSTOM, or on POSITION for CTA — never on `key` alone.
 *
 * Exactly the arrangement StoreSetting's PROMO_SECTION_KEY documents for
 * MID_BANNERS, and for the same reason.
 */
export const LANDING_REPEATABLE_SECTION_KEYS: readonly LandingSectionKey[] = [
    "CTA",
    "CUSTOM",
] as const;

/**
 * The sections a page may never be without.
 *
 * Enforced in the service as well as hidden in the admin, because a warning is
 * dismissed once and the blank page stays live while the ads run. A campaign
 * with no product and no order form is a paid click that can buy nothing.
 *
 * BOTH, since the two were split apart. While they were one key, requiring it
 * covered the form as a side effect; separately, a page can be saved with the
 * form removed and still have a product on it, which is the worse of the two
 * blank pages — it looks like it works.
 */
export const LANDING_REQUIRED_SECTION_KEYS: readonly LandingSectionKey[] = [
    "HERO",
    "ORDER_FORM",
] as const;

/**
 * More than this and the page is a website, not a campaign.
 *
 * Same reasoning as MAX_HIGHLIGHTS and MAX_FAQS above: a landing page is one
 * scrollable document read in a single pass, and the bound also keeps a single
 * Json column from growing without limit.
 */
export const MAX_CUSTOM_SECTIONS = 8;

/** Bounds on one custom section's own copy. */
export const MAX_CUSTOM_SECTION_HEADING = 160;
export const MAX_CUSTOM_SECTION_BODY = 8000;

/**
 * How a custom section arranges its own content.
 *
 * ORDER IS LOAD-BEARING: position 0 is what a section gets when the merchant
 * chooses nothing, and "PROSE" holds it because a heading over a paragraph is
 * the arrangement that needs no further decision from them.
 */
export const LANDING_CUSTOM_SECTION_LAYOUTS = [
    /** A heading with the body beneath it, at the page's reading measure. */
    "PROSE",
    /** The same content centred, for a short statement rather than an argument. */
    "CENTERED",
    /** On the accent wash, for a section that should read as a callout. */
    "HIGHLIGHT",
] as const;

export type LandingCustomSectionLayout =
    (typeof LANDING_CUSTOM_SECTION_LAYOUTS)[number];
