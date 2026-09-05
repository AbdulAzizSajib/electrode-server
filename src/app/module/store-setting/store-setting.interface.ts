import { CurrencyPosition, SiteMode } from "../../../generated/prisma/client";

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
    font: IThemeFont;
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
}

/** What the storefront needs to route the root, from the settings it already fetches. */
export interface IActiveLandingPage {
    slug: string;
    title: string;
}
