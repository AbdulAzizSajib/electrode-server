export interface INavChild {
    label: string;
    href: string;
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

export interface ICheckoutConfig {
    fields: Record<ICheckoutFieldKey, ICheckoutField>;
    showCouponBox: boolean;
    showOrderNote: boolean;
    allowGuestCheckout: boolean;
    notice: string;
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
    defaultTaxRatePercent?: number;
    freeShippingThreshold?: number;
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
}
