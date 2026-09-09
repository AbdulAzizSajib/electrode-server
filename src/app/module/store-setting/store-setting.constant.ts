import { BrandDisplayMode, CurrencyPosition, SiteMode } from "../../../generated/prisma/client";

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
    /*
     * No delivery options, and that is the correct default rather than a gap.
     *
     * There is no delivery setup a store can be given that is right for it: an
     * area named for the wrong city, or a price nobody chose, would be worse
     * than nothing because it would be charged. So a store that has never
     * configured delivery has an empty list, and checkout REFUSES to price an
     * order until the merchant fills it in — a loud, one-time setup step in
     * place of a silently wrong charge. `checkoutConfigSchema` therefore has to
     * keep accepting an empty list; only a merchant SAVE rejects one, via
     * `checkoutConfigUpdateSchema`.
     */
    delivery: {
        offersPickup: false,
        options: [] as {
            key: string;
            label: string;
            kind: "DELIVERY" | "PICKUP";
            price: number;
            days: number;
        }[],
    },
};

/**
 * The storefront's presentation when a store has never configured it.
 *
 * Every colour and the Outfit stylesheet mirror what is compiled into
 * `frontend/src/app/globals.css`, so an unconfigured store looks like the one
 * that shipped.
 *
 * `maxWidth` is the exception: it is 1440, the middle of `SITE_CONTENT_WIDTHS`,
 * rather than the 1384 this shipped with. Content width is now a closed set of
 * four options — see the comment on that constant for why — and 1384 is not one
 * of them. Readers snap a stored width to the nearest option, so a store
 * carrying the old 1384 renders at 1440 — 56px wider — until it is saved again.
 *
 * `font.url` and `adminFont.url` are stored parsed, in the same shape the
 * Google Fonts parser returns, so this constant and a merchant-saved value are
 * indistinguishable to every reader.
 *
 * Both font keys are DENORMALISED copies of a row in the `Font` library, not
 * references to one. A merchant picks from that library and the chosen
 * `{ family, url }` is written here — which is why the storefront read path
 * never joins anything, and why a font cannot be deleted while selected (see
 * font.service.ts).
 */
/**
 * Every optional catalog feature offered.
 *
 * This reproduces the storefront exactly as it behaved before any of it was
 * configurable — which is what lets the migration add the column with no
 * backfill and change nothing for any existing store.
 *
 * It is also the only safe direction to fail in. A settings read that fell back
 * to "off" would strip the wishlist and comparison from a shop that pays for
 * them, and — unlike a blank announcement bar — nobody would read the absence
 * as an outage.
 */
export const DEFAULT_CATALOG_CONFIG = {
    showWishlist: true,
    showCompare: true,
    showQuickView: true,
};

export const DEFAULT_THEME = {
    background: "#ffffff",
    foreground: "#1a1a1a",
    brand: "#0f63b3",
    brandDark: "#133f9e",
    accent: "#f5b301",
    sale: "#e02020",
    maxWidth: 1440,
    font: {
        family: "Outfit",
        url: "https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap",
    },
    /*
     * The ADMIN PANEL's typeface, independent of the storefront's `font` above.
     * Two selections rather than one because the people working behind the
     * counter all day and the customers browsing the shop are not the same
     * audience, and a display face chosen to sell products is not necessarily
     * one to read order tables in.
     *
     * Roboto, NOT Outfit, and that difference is deliberate: Roboto is what the
     * admin panel was hardcoded to before it became configurable. Defaulting to
     * it means an existing install looks identical after this change and only
     * moves when a merchant asks it to. Change this and every shop that never
     * touched the setting silently restyles.
     */
    adminFont: {
        family: "Roboto",
        url: "https://fonts.googleapis.com/css2?family=Roboto:wght@100..900&display=swap",
    },
};

/**
 * The route groups a storefront page can belong to, for per-group robots
 * directives. A CLOSED set, deliberately: the admin renders it as a checklist a
 * merchant can read, Zod validates it exhaustively, and there is no free-form
 * path pattern whose typo could silently deindex the catalog. Custom
 * `robots.txt` lines remain available as the escape hatch for the rare case.
 *
 * The order here is the order the admin renders them: public surfaces first,
 * then the private ones a shop never wants indexed.
 */
export const SEO_ROUTE_GROUPS = [
    "home",
    "product",
    "category",
    "blog",
    "page",
    "landingPage",
    "account",
    "cart",
    "checkout",
    "wishlist",
    "compare",
    "search",
] as const;

export type SeoRouteGroup = (typeof SEO_ROUTE_GROUPS)[number];

/** The content types the sitemap can list, and that `Page SEO` groups rows by. */
export const SEO_CONTENT_TYPES = ["product", "category", "page", "blogPost", "landingPage"] as const;

export type SeoContentType = (typeof SEO_CONTENT_TYPES)[number];

/**
 * Merged over on every read of `StoreSetting.seoConfig`, so a null column, a row
 * written before a key existed, and a fully configured store all yield a
 * complete config. The storefront never has to null-check a nested SEO field.
 *
 * The defaults reproduce the storefront's pre-configuration metadata exactly:
 * no title template, no defaults of its own (the resolver already falls back to
 * `storeName` and the record's own title), and indexing left as the search
 * engines would have found it. So adding the column changed nothing, and this is
 * also the safe direction to fail in — a settings read that fell back to
 * `globalNoindex: true` would deindex a live shop, which nobody would notice
 * until traffic vanished.
 *
 * Private groups ship `noindex, nofollow` because a cart, a checkout and a
 * customer's own account are not pages a search engine should hold; they carry
 * per-visitor state and thin, duplicated content. That is a correction to
 * today's behaviour, and the one default here that is not a no-op.
 */
export const DEFAULT_SEO_CONFIG = {
    /** `%s` is replaced by the page's resolved title. Empty means "no template". */
    titleTemplate: "" as string,
    defaultMetaTitle: "" as string,
    defaultMetaDescription: "" as string,
    defaultOgImageUrl: "" as string,
    twitterCardType: "summary_large_image" as "summary" | "summary_large_image",
    twitterSite: "" as string,

    robots: {
        /**
         * The staging-site kill switch. Overrides every per-group setting below
         * and empties the sitemap — nothing may quietly re-enable indexing while
         * this is on, which is why the override lives in the resolver rather
         * than being merged into the group flags.
         */
        globalNoindex: false,
        groups: {
            home: { index: true, follow: true },
            product: { index: true, follow: true },
            category: { index: true, follow: true },
            blog: { index: true, follow: true },
            page: { index: true, follow: true },
            landingPage: { index: true, follow: true },
            account: { index: false, follow: false },
            cart: { index: false, follow: false },
            checkout: { index: false, follow: false },
            wishlist: { index: false, follow: false },
            compare: { index: false, follow: false },
            search: { index: false, follow: false },
        } as Record<SeoRouteGroup, { index: boolean; follow: boolean }>,
        /** Appended verbatim to the generated robots.txt. */
        customRules: "" as string,
    },

    /** Which content types the generated sitemap lists. */
    sitemap: {
        product: true,
        category: true,
        page: true,
        blogPost: true,
        landingPage: true,
    } as Record<SeoContentType, boolean>,

    structuredData: {
        enableOrganization: true,
        enableProduct: true,
        enableArticle: true,
        enableBreadcrumb: true,
        organization: {
            legalName: "" as string,
            logoUrl: "" as string,
            email: "" as string,
            phone: "" as string,
            /** Social profile URLs, emitted as schema.org `sameAs`. */
            sameAs: [] as string[],
        },
    },

    /**
     * Search-engine ownership tokens. Empty means "emit no tag" — an empty
     * verification meta tag is not neutral, it is a failed verification.
     */
    verification: {
        google: "" as string,
        bing: "" as string,
        other: "" as string,
    },
};

export type SeoConfig = typeof DEFAULT_SEO_CONFIG;

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
    /*
     * TEXT for both, which is what makes this change invisible on deploy: the
     * storefront rendered the wordmark unconditionally in both slots before
     * these existed — it never read the two logo columns above at all — so a
     * store that has not chosen a mode, and a settings read that falls back to
     * these defaults, both render exactly as they always have.
     *
     * Note this is the default MODE, not a fallback for a missing image: a slot
     * set to LOGO whose fallback chain yields no URL renders the wordmark too,
     * which the storefront resolves. See the `storefront-branding` spec, "A
     * brand slot never renders empty".
     */
    headerBrandMode: "TEXT" as BrandDisplayMode,
    footerBrandMode: "TEXT" as BrandDisplayMode,
    /* Mirrors the column defaults; bounded 24-96 by MIN/MAX_LOGO_HEIGHT. */
    headerLogoHeight: 40,
    footerLogoHeight: 36,
    aboutText: STOREFRONT_SEED_DEFAULTS.aboutText,
    copyrightText: STOREFRONT_SEED_DEFAULTS.copyrightText,
    currency: "BDT",
    currencySymbol: "৳",
    /*
     * These two reproduce the storefront's pre-configuration rendering exactly
     * — `formatPrice` was the literal `` `৳${value.toFixed(2)}` `` — so a store
     * that never opens the currency settings renders prices as it always has.
     * They are not neutral blanks for the same reason nothing else here is: a
     * price is on every product card, and there is no safe way to render one
     * without a symbol.
     */
    currencyPosition: "BEFORE" as CurrencyPosition,
    currencyDecimals: 2,
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
    catalogConfig: DEFAULT_CATALOG_CONFIG,
    theme: DEFAULT_THEME,
    seoConfig: DEFAULT_SEO_CONFIG,
    /*
     * WEBSITE and null, so a storefront that cannot reach this API — or reaches
     * an install where nobody has ever opened the landing page screen — renders
     * the normal shop.
     *
     * This is the safe direction to fail in, and the only one. Defaulting to
     * LANDING_PAGE would make an unreachable settings API replace every shop's
     * home page with a 404; defaulting to WEBSITE makes it show the homepage it
     * always showed. See the `store-config/site-mode` spec, "Settings API is
     * unreachable".
     */
    siteMode: "WEBSITE" as SiteMode,
    activeLandingPage: null as { slug: string; title: string } | null,
};
