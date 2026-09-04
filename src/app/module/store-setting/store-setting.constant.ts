/**
 * Storefront presentation defaults for the StoreSetting singleton.
 *
 * These mirror the content that was previously hardcoded in the Next.js
 * storefront (`src/data/content.ts`, `Header.tsx`, `Footer.tsx`), so the site
 * renders identically the first time it reads settings from the API.
 *
 * Two distinct consumers, deliberately separate:
 *  - STOREFRONT_SEED_DEFAULTS is written to the DB once by the backfill script.
 *  - DEFAULT_PUBLIC_SETTINGS is merged over on every public read, so a column an
 *    admin later clears still yields a usable header/footer rather than a blank
 *    one.
 */

export const SINGLETON_ID = "singleton";

export const DEFAULT_MAIN_NAV = [
    { label: "Home", href: "/" },
    { label: "Shop", href: "/products" },
    { label: "Best Selling", href: "/products?sort=best" },
    { label: "New Arrivals", href: "/products?sort=new" },
    { label: "Blogs", href: "/blogs" },
    { label: "Contact", href: "/contact" },
];

export const DEFAULT_FOOTER_COLUMNS = [
    {
        title: "Information",
        links: [
            { label: "Size Chart", href: "/size-chart" },
            { label: "Shipping", href: "/shipping" },
            { label: "Legal Notice", href: "/legal-notice" },
            { label: "Delivery", href: "/delivery" },
            { label: "Shipping & Refund", href: "/shipping-refund" },
            { label: "Sitemap", href: "/sitemap" },
        ],
    },
    {
        title: "Your Account",
        links: [
            { label: "Search", href: "/products" },
            { label: "About Us", href: "/about" },
            { label: "Delivery Information", href: "/delivery" },
            { label: "Contact", href: "/contact" },
            { label: "Our Stories", href: "/our-stories" },
            { label: "FAQs", href: "/faqs" },
        ],
    },
    {
        title: "Quick Links",
        links: [
            { label: "Privacy Policy", href: "/privacy-policy" },
            { label: "Refund Policy", href: "/refund-policy" },
            { label: "Shipping Policy", href: "/shipping-policy" },
            { label: "Terms of Service", href: "/terms-of-service" },
            { label: "Policy for Buyers", href: "/policy-buyers" },
            { label: "Policy for Sellers", href: "/policy-sellers" },
        ],
    },
];

export const DEFAULT_SOCIAL_LINKS = [
    { platform: "facebook", url: "https://facebook.com" },
    { platform: "instagram", url: "https://instagram.com" },
    { platform: "youtube", url: "https://youtube.com" },
    { platform: "x", url: "https://x.com" },
];

/**
 * `source` on the first two rows is what keeps the bar honest: it tells the
 * storefront to render that link's label and href from the store's contact
 * columns rather than from the literals stored here, so changing the phone
 * number in one place updates the header bar and the footer contact block
 * together. A row without `source` is a plain merchant-authored link.
 *
 * The literals are still filled in as the fallback for a store that has not set
 * its contact columns yet.
 */
export const DEFAULT_ANNOUNCEMENT_BAR = {
    enabled: true,
    text: "Free delivery & 40% discount for next 3 orders! Place your 1st order in.",
    links: [
        {
            icon: "akar-icons:whatsapp-fill",
            label: "+8801782521705",
            href: "https://wa.me/8801782521705",
            source: "contactPhone",
        },
        {
            icon: "garden:email-stroke-16",
            label: "contact@sheisite.com",
            href: "mailto:contact@sheisite.com",
            source: "contactEmail",
        },
        { icon: "fa-solid:truck", label: "Track Order", href: "/track-order" },
    ],
};

export const DEFAULT_NEWSLETTER = {
    // ৳, not $ — the store's currencySymbol is BDT's. The storefront rendered
    // "৳10 Off" while this constant said "$10", which would have been a visible
    // regression the moment the footer started reading from settings.
    heading: "Join Our Newsletter For ৳10 Off",
    subtext:
        "Subscribe to our latest newsletter to get news about special discounts and upcoming sales.",
    placeholder: "Email",
    buttonLabel: "Subscribe",
};

/**
 * What checkout asks for when a store has never configured it.
 *
 * These reproduce the storefront's PREVIOUS hardcoded behaviour exactly — name,
 * phone, address and city required; apartment and postal code optional; the
 * order note shown; guest checkout allowed; no notice. That equivalence is the
 * whole reason the migration needs no backfill: an existing store reads these
 * and behaves as it always did.
 *
 * `phone` is shown and required here and cannot be anything else — see the
 * floor enforced in checkoutConfigSchema and re-checked in order.service.ts.
 */
export const DEFAULT_CHECKOUT_CONFIG = {
    fields: {
        fullName: { show: true, required: true },
        phone: { show: true, required: true },
        addressLine1: { show: true, required: true },
        addressLine2: { show: true, required: false },
        city: { show: true, required: true },
        postalCode: { show: true, required: false },
    },
    // The cart page's coupon box was always visible before this change, and the
    // checkout page had none; the default keeps the cart's and adds checkout's.
    showCouponBox: true,
    showOrderNote: true,
    allowGuestCheckout: true,
    notice: "",
};

/**
 * The storefront's presentation when a store has never configured it.
 *
 * Every value here mirrors what is compiled into `frontend/src/app/globals.css`
 * today: the same six colours, the same Outfit stylesheet, and `maxWidth: 1384`
 * — which is exactly `max-w-346` (346 × 0.25rem = 86.5rem). An unconfigured
 * store must be pixel-identical to the one that shipped before this change.
 *
 * `font.url` is stored parsed, in the same shape the Google Fonts parser
 * returns, so this constant and a merchant-saved value are indistinguishable to
 * every reader.
 */
export const DEFAULT_THEME = {
    background: "#ffffff",
    foreground: "#1a1a1a",
    brand: "#0f63b3",
    brandDark: "#133f9e",
    accent: "#f5b301",
    sale: "#e02020",
    maxWidth: 1384,
    font: {
        family: "Outfit",
        url: "https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap",
    },
};

/**
 * Seeded into the DB by scripts/backfill-storefront-engagement.ts. Scalars only
 * where the column is nullable — `storeName`, `currency` and `currencySymbol`
 * already carry Prisma-level defaults and are intentionally absent here.
 */
export const STOREFRONT_SEED_DEFAULTS = {
    storeName: "Gadgets",
    siteNameAccent: "Mart",
    aboutText:
        "Welcome to our store, where we pride ourselves on providing exceptional products and unparalleled customer service, style and innovation.",
    copyrightText: "Gadgets Mart - Electronics Store. Built with Next.js.",
    /*
     * The storefront carried TWO contact identities before this change: the
     * header's announcement bar used contact@sheisite.com / +8801782521705,
     * while the footer's "About Information" block used demo@example.com /
     * (+91) 9876-543-210. One column cannot serve both, so the header's values
     * win — they are the real ones (the number matches the store's BDT
     * currency; the footer pair are the demo theme's placeholders).
     *
     * Consequence: the footer's contact block changes visibly on first deploy.
     * That is the point — the two blocks now agree.
     */
    contactEmail: "contact@sheisite.com",
    contactPhone: "+8801782521705",
    address: "Electrode - Electronics Store, 507 Union Trade, Ipsum Dolor Centre",
    mainNav: DEFAULT_MAIN_NAV,
    footerColumns: DEFAULT_FOOTER_COLUMNS,
    socialLinks: DEFAULT_SOCIAL_LINKS,
    announcementBar: DEFAULT_ANNOUNCEMENT_BAR,
    newsletter: DEFAULT_NEWSLETTER,
};

/**
 * Merged over the stored row on every public read. Covers the non-nullable
 * scalars too, so the payload is complete even before the seed script runs or
 * if an admin clears an optional field.
 */
export const DEFAULT_PUBLIC_SETTINGS = {
    /*
     * These mirror STOREFRONT_SEED_DEFAULTS rather than being neutral blanks.
     * The storefront renders its header and footer from this payload on EVERY
     * page, so an unseeded install or a cleared column must still produce the
     * real chrome — a blank wordmark and an empty footer are worse than a
     * default that happens to be stale.
     */
    storeName: "Gadgets",
    siteNameAccent: "Mart",
    logoUrl: null as string | null,
    /*
     * Null, not a copy of `logoUrl`: the storefront's own fallback is "footer
     * logo, else header logo, else the wordmark", and resolving that here would
     * make "no footer logo set" indistinguishable from "footer logo set to the
     * same image as the header".
     */
    footerLogoUrl: null as string | null,
    aboutText: STOREFRONT_SEED_DEFAULTS.aboutText,
    copyrightText: STOREFRONT_SEED_DEFAULTS.copyrightText,
    currency: "BDT",
    currencySymbol: "৳",
    contactEmail: STOREFRONT_SEED_DEFAULTS.contactEmail as string | null,
    contactPhone: STOREFRONT_SEED_DEFAULTS.contactPhone as string | null,
    address: STOREFRONT_SEED_DEFAULTS.address as string | null,
    /*
     * Null rather than a guessed origin. An absolute metadata URL resolved
     * against the wrong host is worse than a relative one — it would point
     * social previews and canonical links at somebody else's site.
     */
    siteUrl: null as string | null,
    /*
     * Null so the storefront applies its own documented fallback (the site
     * name) rather than this layer inventing a title. `metaDescription` has no
     * sensible generic default at all.
     */
    metaTitle: null as string | null,
    metaDescription: null as string | null,
    mainNav: DEFAULT_MAIN_NAV,
    footerColumns: DEFAULT_FOOTER_COLUMNS,
    socialLinks: DEFAULT_SOCIAL_LINKS,
    announcementBar: DEFAULT_ANNOUNCEMENT_BAR,
    newsletter: DEFAULT_NEWSLETTER,
    checkoutConfig: DEFAULT_CHECKOUT_CONFIG,
    theme: DEFAULT_THEME,
};
