import {
    BrandDisplayMode,
    CourierProvider,
    CurrencyPosition,
    SiteMode,
} from "../../../generated/prisma/client";

export interface INavChild {
    label: string;
    href: string;
}

/**
 * Everything needed to write a monetary amount, gathered into one value.
 *
 * Passed around as a unit rather than as four loose arguments because the four
 * are only ever meaningful together — a symbol without its position renders on
 * the wrong side, and a decimal count without its symbol renders a bare number.
 * The storefront and the admin panel each build the same shape from the public
 * settings payload.
 */
export interface ICurrencyFormat {
    symbol: string;
    position: CurrencyPosition;
    /** Presentation only. Never changes what is stored, computed or charged. */
    decimals: number;
}

/** One level of nesting only — INavChild has no `children` of its own. */
export interface INavItem extends INavChild {
    children?: INavChild[];
}

export interface IFooterColumn {
    title: string;
    links: INavChild[];
}

export type SocialPlatform = "facebook" | "instagram" | "youtube" | "x" | "pinterest";

export interface ISocialLink {
    platform: SocialPlatform;
    url: string;
}

/** See store-setting.validation.ts on what `source` binds a link to. */
export type IAnnouncementLinkSource = "contactPhone" | "contactEmail";

export interface IAnnouncementBar {
    enabled: boolean;
    text: string;
    links?: {
        icon?: string;
        label: string;
        href: string;
        source?: IAnnouncementLinkSource;
    }[];
}

export interface INewsletter {
    heading: string;
    subtext: string;
    placeholder?: string;
    buttonLabel?: string;
}

/** The six checkout fields a merchant may configure. Keys match the order payload. */
export type ICheckoutFieldKey =
    | "fullName"
    | "phone"
    | "addressLine1"
    | "addressLine2"
    | "city"
    | "postalCode";

export interface ICheckoutField {
    show: boolean;
    required: boolean;
}

/** Whether an option is delivered to the shopper or collected by them. */
export type IDeliveryKind = "DELIVERY" | "PICKUP";

/**
 * One delivery choice offered at checkout.
 *
 * Carries no destination criteria by design: the shopper picks this, it is
 * never matched from the address they typed. `key` survives a rename so orders
 * can still be grouped by it; `label` is captured onto the order.
 */
export interface IDeliveryOption {
    key: string;
    label: string;
    kind: IDeliveryKind;
    price: number;
    days: number;
}

export interface IDeliverySettings {
    /** When false, pickup options are not offered even if some are configured. */
    offersPickup: boolean;
    /** Empty only for a store that has never configured delivery, which cannot take orders. */
    options: IDeliveryOption[];
}

export interface ICheckoutConfig {
    fields: Record<ICheckoutFieldKey, ICheckoutField>;
    showCouponBox: boolean;
    showOrderNote: boolean;
    allowGuestCheckout: boolean;
    notice: string;
    delivery: IDeliverySettings;
}

/** Always the parsed pair — see google-font.ts on why the URL is rebuilt, never stored raw. */
export interface IThemeFont {
    family: string;
    url: string;
}

export interface ITheme {
    background: string;
    foreground: string;
    brand: string;
    brandDark: string;
    accent: string;
    sale: string;
    /** Pixels, or `"full"` for an unconstrained content width. */
    maxWidth: number | "full";
    /** The storefront's typeface. */
    font: IThemeFont;
    /**
     * The admin panel's typeface, chosen independently of the storefront's.
     *
     * Optional on the way IN only — a caller written before the admin panel had
     * a font of its own omits it, and the service carries the stored value
     * forward rather than blanking it. Every READ resolves it, falling back to
     * DEFAULT_THEME.adminFont, so a reader never has to handle its absence.
     */
    adminFont?: IThemeFont;
}

/**
 * Per-route-group indexing. Both flags, always — see `groups` in
 * seoConfigSchema for why a missing one is worse than a wrong one.
 */
export interface ISeoRobotsGroup {
    index: boolean;
    follow: boolean;
}

/** Keys mirror SEO_ROUTE_GROUPS in store-setting.constant.ts. */
export interface ISeoRobots {
    /** Overrides every group below, and empties the sitemap. */
    globalNoindex: boolean;
    groups: Record<
        | "home"
        | "product"
        | "category"
        | "blog"
        | "page"
        | "landingPage"
        | "account"
        | "cart"
        | "checkout"
        | "wishlist"
        | "compare"
        | "search",
        ISeoRobotsGroup
    >;
    /** Appended verbatim to the generated robots.txt. */
    customRules: string;
}

export interface ISeoOrganization {
    legalName: string;
    logoUrl: string;
    email: string;
    phone: string;
    /** Social profile URLs, emitted as schema.org `sameAs`. */
    sameAs: string[];
}

/**
 * Everything the SEO menu owns beyond `siteUrl`/`metaTitle`/`metaDescription`,
 * which remain columns of their own.
 *
 * Every field is required: the blob is replaced wholesale on write, so an
 * optional field here would be a screen silently dropping another's value. `""`
 * is how a text field expresses "unset" — the storefront treats it as absent and
 * falls through to its next fallback.
 */
export interface ISeoConfig {
    /** `%s` is replaced by the page's resolved title. `""` means no template. */
    titleTemplate: string;
    defaultMetaTitle: string;
    defaultMetaDescription: string;
    defaultOgImageUrl: string;
    twitterCardType: "summary" | "summary_large_image";
    twitterSite: string;
    robots: ISeoRobots;
    /** Which content types the generated sitemap lists. */
    sitemap: Record<"product" | "category" | "page" | "blogPost" | "landingPage", boolean>;
    structuredData: {
        enableOrganization: boolean;
        enableProduct: boolean;
        enableArticle: boolean;
        enableBreadcrumb: boolean;
        organization: ISeoOrganization;
    };
    /** `""` means emit no tag — an empty verification tag is a failed one. */
    verification: {
        google: string;
        bing: string;
        other: string;
    };
}

export interface IUpdateStoreSettingPayload {
    storeName?: string;
    currency?: string;
    currencySymbol?: string;
    currencyPosition?: CurrencyPosition;
    currencyDecimals?: number;
    /**
     * `null` means "withdraw the offer", which an omitted key cannot express
     * under a partial upsert — see the schema's note in
     * store-setting.validation.ts. Distinct from `0`, which makes every order's
     * delivery free.
     */
    freeShippingThreshold?: number | null;
    contactEmail?: string;
    contactPhone?: string;
    address?: string;

    logoUrl?: string;
    footerLogoUrl?: string;
    siteNameAccent?: string;
    aboutText?: string;
    copyrightText?: string;

    /**
     * Which of the two things each brand slot shows, set independently.
     *
     * The mode decides — not whether `logoUrl`/`footerLogoUrl` above are set —
     * so a slot showing the wordmark keeps its artwork on file. Omitting a key
     * leaves that slot's mode unchanged, as with every other optional scalar.
     */
    headerBrandMode?: BrandDisplayMode;
    footerBrandMode?: BrandDisplayMode;
    /** Pixels, bounded 24-96 by the schema. Width follows the image. */
    headerLogoHeight?: number;
    footerLogoHeight?: number;

    siteUrl?: string;
    metaTitle?: string;
    metaDescription?: string;

    mainNav?: INavItem[];
    footerColumns?: IFooterColumn[];
    socialLinks?: ISocialLink[];
    announcementBar?: IAnnouncementBar;
    newsletter?: INewsletter;

    checkoutConfig?: ICheckoutConfig;
    /**
     * Note the asymmetry with the request body: `theme.font` arrives as the
     * text the merchant pasted and is parsed by the schema, so by the time a
     * payload has this type its font is already the validated pair.
     */
    theme?: ITheme;

    /**
     * Optional like the blobs above — omitting it leaves the column untouched.
     * But a PRESENT value replaces the whole blob rather than merging into it,
     * so a caller must send the full merged config, not a slice of one.
     */
    seoConfig?: ISeoConfig;

    /**
     * Whether the storefront root serves the shop or a campaign landing page,
     * and which page that is.
     *
     * `null` on `activeLandingPageId` means "no page selected", which an omitted
     * key cannot express under a partial upsert — the same reason
     * `freeShippingThreshold` above is nullable rather than merely optional.
     * Clearing it while `siteMode` is LANDING_PAGE is refused in the service:
     * the two are only meaningful together, and their invariants need a
     * database read that Zod cannot do.
     */
    siteMode?: SiteMode;
    activeLandingPageId?: string | null;

    /**
     * Which courier the shop dispatches through.
     *
     * Optional but never null — unlike `activeLandingPageId` above, there is no
     * "deselected" state to express. MANUAL is the selection a merchant makes
     * when their courier has no integration here, so every shop always resolves
     * to a provider.
     *
     * Only the SELECTION lives on this row. The credentials stay in the
     * environment, because `GET /settings` is public.
     *
     * Changing this is refused while consignments are in flight with the
     * current courier — see store-setting.service.ts.
     */
    courierProvider?: CourierProvider;
}

/** What the storefront needs to route the root, from the settings it already fetches. */
export interface IActiveLandingPage {
    slug: string;
    title: string;
}
