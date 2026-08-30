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

export interface IAnnouncementBar {
    enabled: boolean;
    text: string;
    links?: { icon?: string; label: string; href: string }[];
}

export interface INewsletter {
    heading: string;
    subtext: string;
    placeholder?: string;
    buttonLabel?: string;
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
    siteNameAccent?: string;
    aboutText?: string;
    copyrightText?: string;

    mainNav?: INavItem[];
    footerColumns?: IFooterColumn[];
    socialLinks?: ISocialLink[];
    announcementBar?: IAnnouncementBar;
    newsletter?: INewsletter;
}
