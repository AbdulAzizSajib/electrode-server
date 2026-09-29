import { LandingPageStatus } from "../../../generated/prisma/client";
import type {
    LandingCustomSectionLayout,
    LandingSectionKey,
} from "./landing-page.constant";
import type { IAdvanceSplit } from "../order/order.pricing";
import type { IAdvanceClaimPayload } from "../order/order.interface";

/**
 * The shapes behind LandingPage's Json columns.
 *
 * Every one of these is validated by landing-page.validation.ts on write and
 * TRUSTED on read, exactly as StoreSetting's Json columns are — the Zod schemas
 * are the only gate, so a value that reached the database went through them.
 */

/** One gallery entry. A landing page sells with pictures and a video, in the merchant's order. */
export interface ILandingPageMedia {
    type: "IMAGE" | "VIDEO";
    url: string;
    /** Poster frame for a VIDEO; ignored for an IMAGE. */
    thumbnailUrl?: string;
    alt?: string;
}

/** A "কেন কিনবেন" bullet. `icon` is an Iconify name, matching the announcement bar's links. */
export interface ILandingPageHighlight {
    icon?: string;
    title: string;
    text?: string;
}

export interface ILandingPageFaq {
    question: string;
    answer: string;
}

/** Social proof authored on the page itself, not the shop-wide Testimonial model. */
export interface ILandingPageQuote {
    name: string;
    /**
     * Optional, because a review may be a SCREENSHOT instead — the message a
     * customer actually sent. A quote must carry text or an image; the Zod
     * schema rejects one with neither, since an empty card is worse than none.
     */
    text?: string;
    rating?: number;
    /** The reviewer's own avatar. */
    photoUrl?: string;
    /** The review itself as an image. */
    imageUrl?: string;
}

export interface ILandingPageTrustBadge {
    icon?: string;
    label: string;
}

/**
 * One tier a campaign offers — a size, a bundle, a quantity.
 *
 * `key` is authored once and NEVER rewritten, because an order records it.
 * `price` is the one price a landing page may author; see the model comment on
 * LandingPage.prisma for why that is safe and what makes it so.
 */
export interface ILandingPagePackage {
    key: string;
    label: string;
    productId: string;
    price: number;
    /** The struck-through "was" figure. Always above `price`, enforced in Zod. */
    compareAtPrice?: number;
    freeGiftText?: string;
    badge?: string;
    preselected?: boolean;
}

/** Numbered "why we are different" reasons. */
export interface ILandingPageWhyUs {
    title: string;
    text?: string;
}

/** "What would I do with this" — a short label, optionally with an icon. */
export interface ILandingPageUsageIdea {
    label: string;
    icon?: string;
}

/**
 * A campaign's own look — every colour the page draws, as named tokens.
 *
 * All optional: each falls back to the value the storefront's globals.css
 * declares, which is what the page rendered before tokens existed. Every value
 * is a strict hex, validated on write, because these reach the page as CSS
 * custom properties in an inline style attribute.
 *
 * See openspec/changes/add-landing-page-theme-tokens, design.md Decision 2.
 */
export interface ILandingPageTheme {
    /** The campaign's colour: buttons, badges, active states. */
    accent?: string;
    /** A wash of it — band backgrounds and selected-card fills. */
    accentSoft?: string;
    /** What is legible ON the accent, usually white. */
    accentContrast?: string;
    /** The primary content background. */
    surface?: string;
    /** The alternating band background. */
    surfaceAlt?: string;
    /** Body and heading colour. */
    text?: string;
    /** Secondary copy. One muted weight; a second is opacity on this. */
    textMuted?: string;
    /** Every rule and card edge. */
    border?: string;
    displayFont?: { family: string; url: string };
}

/**
 * What this page sells RIGHT NOW — the single answer every pricing path reads.
 *
 * Returned by `resolveLandingPackage`. The page render, the quote and the order
 * placement all take their product and their price from here, which is what
 * makes an authored package price safe: there is no second path to disagree
 * with. See openspec/changes/add-conversion-landing-page-sections, design.md
 * Decision 1.
 *
 * `packageKey` is null for a page with no packages — that page sells its bound
 * product at the product's own price, exactly as before packages existed.
 */
export interface IResolvedLandingPackage {
    productId: string;
    /**
     * What one unit costs, BEFORE any campaign discount is applied.
     *
     * Null for a page with no packages, meaning "read the product's own
     * offerPrice". A package's authored price is a number here, and the
     * campaign resolver is applied on top of whichever it is — so a campaign
     * running against a package's product still reaches the page that sells it.
     */
    authoredPrice: number | null;
    packageKey: string | null;
    packageLabel: string | null;
    freeGiftText: string | null;
    compareAtPrice: number | null;
}

/** Authored presentation for one order-form field. */
export interface ILandingPageFormField {
    label: string;
    placeholder?: string;
    helper?: string;
}

/**
 * The order form's authored copy and its one real switch.
 *
 * `fullName.required` is the ONLY requiredness a merchant controls. Phone and
 * address carry no such flag by construction — phone because the per-phone COD
 * cap and guest order lookup are both keyed on it, address because a COD parcel
 * with no address cannot be delivered. There is deliberately nowhere to spell
 * "hide the phone field", so no payload can ask for it.
 *
 * StoreSetting.checkoutConfig does NOT govern this form. It describes six
 * fields this page does not ask for, and a shop whose normal checkout requires
 * a postal code must still be able to run a three-field campaign page.
 */
export interface ILandingPageOrderForm {
    heading?: string;
    subheading?: string;
    fields: {
        fullName: ILandingPageFormField & { required: boolean };
        phone: ILandingPageFormField;
        address: ILandingPageFormField;
    };
    submitLabel: string;
    notice?: string;
}

/**
 * One entry in a landing page's section order.
 *
 * ORDER IS THE DATA: an entry's position in the array IS where that section
 * renders. See LandingPage.prisma and landing-page.validation.ts.
 *
 * The four optional fields belong to `CUSTOM` alone. A built-in section carries
 * none of them - its content lives in its own column - and the validation
 * refuses them on any other key rather than ignoring them.
 */
export interface ILandingSectionConfigEntry {
    key: LandingSectionKey;
    /**
     * False hides the section WITHOUT touching its content.
     *
     * That distinction is the point: emptying a section and disabling one are
     * different acts, and only the second is reversible for free.
     */
    enabled: boolean;
    /**
     * A CUSTOM section's identity, stable across saves.
     *
     * Position is NOT an identity - matching on it would reattach a merchant's
     * heading and body to a different section the first time they dragged one.
     */
    id?: string;
    heading?: string;
    /** Merchant-authored HTML, sanitised where it meets the browser. */
    body?: string;
    layout?: LandingCustomSectionLayout;
}
export interface ICreateLandingPagePayload {
    title: string;
    /** Omitted means "derive it from the title" (landing-page.service.ts). */
    slug?: string;
    status?: LandingPageStatus;
    productId: string;

    headline: string;
    subheadline?: string;
    badgeText?: string;
    bodyHtml: string;

    media?: ILandingPageMedia[];
    highlights?: ILandingPageHighlight[];
    faqs?: ILandingPageFaq[];
    quotes?: ILandingPageQuote[];
    trustBadges?: ILandingPageTrustBadge[];

    /** Optional on create only because the service fills it from the Bangla seed default. */
    orderForm?: ILandingPageOrderForm;

    /*
     * Offer mechanics — all optional and absent by default. A page that sets
     * none of them behaves exactly as pages did before packages existed.
     */
    packages?: ILandingPagePackage[];
    whyUs?: ILandingPageWhyUs[];
    usageIdeas?: ILandingPageUsageIdea[];
    /** An absolute instant, never a duration. See LandingPage.prisma. */
    offerEndsAt?: string;
    stopOrdersAtDeadline?: boolean;
    /** The SIZE of a limited run. How many are taken is counted, never stored. */
    scarcityTarget?: number;
    orderPhone?: string;
    /**
     * Whether this campaign collects money before the order ships.
     *
     * Decides only WHETHER to ask. The accounts come from the shop's
     * `checkoutConfig.advancePayment`, shared by every campaign.
     */
    requiresAdvancePayment?: boolean;
    theme?: ILandingPageTheme;
    /**
     * Which sections this page renders, and in what order.
     *
     * ABSENT means "leave unchanged" on update and "never configured" on
     * create - and the second is what the storefront resolves to the default
     * order, so a page that never reaches the section editor renders exactly as
     * it did before this field existed.
     *
     * An EMPTY ARRAY is a different value and is rejected: a page with no HERO
     * cannot be stored. See landing-page.validation.ts.
     */
    sectionConfig?: ILandingSectionConfigEntry[];

    successHeading?: string;
    successMessage?: string;

    metaTitle?: string;
    metaDescription?: string;
    ogImageUrl?: string;
    facebookPixelId?: string;

    sortOrder?: number;
}

export type IUpdateLandingPagePayload = Partial<ICreateLandingPagePayload>;

/**
 * What the storefront needs about the product to render the page, resolved
 * server-side.
 *
 * `unitPrice` and `sellingPrice` come from the Product — a landing page
 * cannot author a price (see LandingPage.prisma). `available` is the summed
 * stock the checkout would actually find, so the page's "out of stock" state
 * and the order endpoint's rejection agree.
 */
export interface ILandingPageProductSnapshot {
    id: string;
    name: string;
    slug: string;
    /** The product's `offerPrice` — what a unit actually costs the shopper. */
    unitPrice: number;
    /** The product's `sellingPrice`, struck through beside it. */
    sellingPrice: number | null;
    unit: string | null;
    images: { url: string; alt: string | null }[];
    available: number;
    isOrderable: boolean;
}

/** `POST /landing-pages/by-slug/:slug/quote` — what the page displays before submitting. */
export interface ILandingPageQuoteResult {
    quantity: number;
    /** The SHOP's delivery option this order is priced by. */
    deliveryOptionKey: string;
    deliveryOptionLabel: string;
    subtotal: number;
    taxAmount: number;
    shippingAmount: number;
    totalAmount: number;
    /**
     * What each advance-payment choice costs — what the shopper sends now and
     * what remains for the door. The same shape the shop's own checkout quote
     * returns, computed by the same function.
     *
     * Always present, even on a campaign that does not ask for an advance: it
     * is a pure derivation of `totalAmount`, and a quote that omitted it would
     * have to be re-fetched the moment a merchant flipped the switch.
     */
    advanceOptions: Record<"DELIVERY_CHARGE" | "FULL", IAdvanceSplit>;
}

/** `POST /landing-pages/by-slug/:slug/order` request body, after validation. */
/**
 * Where the order is going, as the shopper chose it.
 *
 * The same pair the shop's checkout captures. The storefront resolves it to one
 * of the shop's delivery options and submits that key; this travels alongside so
 * the order records the place, not just the band it fell into.
 */
export interface ILandingDestination {
    district: string;
    area: string;
}

export interface IPlaceLandingPageOrderPayload {
    quantity: number;
    /** One of the SHOP's delivery options, resolved from the destination. */
    deliveryOptionKey: string;
    destination?: ILandingDestination;
    /** Which tier was picked. Absent on a page with no packages. */
    packageKey?: string;
    fullName?: string;
    phone: string;
    address: string;
    notes?: string;
    expectedTotal?: number;
    /**
     * How the shopper paid. Absent means cash on delivery, which is what every
     * campaign order was before advance payment reached this path.
     */
    paymentMethod?: string;
    /**
     * The advance-payment claim, when the campaign asks for one.
     *
     * The same shape the shop's checkout collects — forwarded to
     * `OrderService.placeOrder`, which validates the account, refuses a reused
     * reference and computes the amount. Refused outright on a campaign that
     * does not ask for an advance.
     */
    advancePayment?: IAdvanceClaimPayload;
}
