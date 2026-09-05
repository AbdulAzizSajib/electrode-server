import type { IDeliveryZone, ILandingPageOrderForm } from "./landing-page.interface";

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
 * The two zones every Bangladeshi single-product page offers.
 *
 * Seeded rather than left empty because an empty zone list is not a valid page
 * — a page with no zone can charge no delivery, and its product would be
 * undeliverable (enforced in landing-page.validation.ts). The prices are the
 * conventional ones and are the first thing most merchants will change.
 *
 * `key` is stable and ASCII on purpose: it is what the browser sends back and
 * what the server looks the price up by, so it must survive being put in a form
 * value and a JSON body. The Bangla is in `label`, which is what a shopper reads
 * and what is copied onto the order.
 */
export const DEFAULT_DELIVERY_ZONES: IDeliveryZone[] = [
    { key: "inside-dhaka", label: "ঢাকার ভিতরে", price: 60 },
    { key: "outside-dhaka", label: "ঢাকার বাইরে", price: 120 },
];

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
export const MAX_DELIVERY_ZONES = 5;

/**
 * The most units one landing-page order may carry.
 *
 * Matches the per-line cap the normal checkout already applies
 * (`checkoutItemZodSchema` in order.validation.ts), so a quantity that would be
 * refused in the cart is refused here for the same reason and with the same
 * number.
 */
export const MAX_ORDER_QUANTITY = 100;
