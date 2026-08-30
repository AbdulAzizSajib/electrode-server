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

export const DEFAULT_ANNOUNCEMENT_BAR = {
    enabled: true,
    text: "Free delivery & 40% discount for next 3 orders! Place your 1st order in.",
    links: [
        { icon: "akar-icons:whatsapp-fill", label: "+8801782521705", href: "/contact" },
        { icon: "garden:email-stroke-16", label: "contact@example.com", href: "/contact" },
        { icon: "fa-solid:truck", label: "Track Order", href: "/track-order" },
    ],
};

export const DEFAULT_NEWSLETTER = {
    heading: "Join Our Newsletter For $10 Off",
    subtext:
        "Subscribe to our latest newsletter to get news about special discounts and upcoming sales.",
    placeholder: "Email",
    buttonLabel: "Subscribe",
};

/**
 * Seeded into the DB by scripts/backfill-storefront-engagement.ts. Scalars only
 * where the column is nullable — `storeName`, `currency` and `currencySymbol`
 * already carry Prisma-level defaults and are intentionally absent here.
 */
export const STOREFRONT_SEED_DEFAULTS = {
    siteNameAccent: "Mart",
    aboutText:
        "Welcome to our store, where we pride ourselves on providing exceptional products and unparalleled customer service, style and innovation.",
    copyrightText: "Electrode - Electronics Store. Built with Next.js.",
    contactEmail: "demo@example.com",
    contactPhone: "(+91) 9876-543-210",
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
    storeName: "Ecom",
    siteNameAccent: "",
    logoUrl: null as string | null,
    aboutText: "",
    copyrightText: "",
    currency: "BDT",
    currencySymbol: "৳",
    contactEmail: null as string | null,
    contactPhone: null as string | null,
    address: null as string | null,
    mainNav: DEFAULT_MAIN_NAV,
    footerColumns: DEFAULT_FOOTER_COLUMNS,
    socialLinks: DEFAULT_SOCIAL_LINKS,
    announcementBar: DEFAULT_ANNOUNCEMENT_BAR,
    newsletter: DEFAULT_NEWSLETTER,
};
