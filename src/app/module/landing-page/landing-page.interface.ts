import { LandingPageStatus } from "../../../generated/prisma/client";

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
    text: string;
    rating?: number;
    photoUrl?: string;
}

export interface ILandingPageTrustBadge {
    icon?: string;
    label: string;
}

/**
 * One delivery option offered on the page — the `ঢাকার ভিতরে ৳60` /
 * `ঢাকার বাইরে ৳120` pair every Bangladeshi single-product page carries.
 *
 * `key` is what the browser sends back and what the server looks the price up
 * by; `price` is what is CHARGED. The submitted price is never trusted, and the
 * label is copied onto the order's shipping address so the merchant and the
 * courier can both read which area the shopper declared.
 */
export interface IDeliveryZone {
    key: string;
    label: string;
    price: number;
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

    /** Both optional on create only because the service fills them from the Bangla seed defaults. */
    deliveryZones?: IDeliveryZone[];
    orderForm?: ILandingPageOrderForm;

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
 * `unitPrice` and `compareAtPrice` come from the Product — a landing page
 * cannot author a price (see LandingPage.prisma). `available` is the summed
 * stock the checkout would actually find, so the page's "out of stock" state
 * and the order endpoint's rejection agree.
 */
export interface ILandingPageProductSnapshot {
    id: string;
    name: string;
    slug: string;
    unitPrice: number;
    compareAtPrice: number | null;
    unit: string | null;
    images: { url: string; alt: string | null }[];
    available: number;
    isOrderable: boolean;
}

/** `POST /landing-pages/by-slug/:slug/quote` — what the page displays before submitting. */
export interface ILandingPageQuoteResult {
    quantity: number;
    zoneKey: string;
    zoneLabel: string;
    subtotal: number;
    taxAmount: number;
    shippingAmount: number;
    totalAmount: number;
}

/** `POST /landing-pages/by-slug/:slug/order` request body, after validation. */
export interface IPlaceLandingPageOrderPayload {
    quantity: number;
    zoneKey: string;
    fullName?: string;
    phone: string;
    address: string;
    notes?: string;
    expectedTotal?: number;
}
