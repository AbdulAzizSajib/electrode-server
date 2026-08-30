import { Banner, BannerPlacement, BannerType, Prisma } from "../../../generated/prisma/client";

export interface ICreateBannerPayload {
    type?: BannerType;
    // Derived from the generated Prisma enum rather than re-listed as string
    // literals, so adding a placement to the schema cannot leave this behind.
    placement: BannerPlacement;

    /** Required for IMAGE, optional for DYNAMIC (enforced in banner.validation.ts). */
    image?: string;
    mobileImage?: string;

    // DYNAMIC only — rejected on an IMAGE banner (see banner.validation.ts).
    title?: string;
    subtitle?: string;
    description?: string;
    price?: number;
    discountPrice?: number;
    buttonText?: string;
    bgColor?: string;
    textColor?: string;

    link?: string;
    productId?: string;

    status?: "DRAFT" | "ACTIVE" | "INACTIVE" | "SCHEDULED";
    sortOrder?: number;
    startsAt?: string;
    endsAt?: string;
}

export type IUpdateBannerPayload = Partial<ICreateBannerPayload>;

/** Slim linked-product summary — enough to render a banner without a second request. */
export interface IBannerProductSummary {
    id: string;
    name: string;
    slug: string;
    /** Decimal — serializes to a string in JSON, like every other price in this API. */
    price: Prisma.Decimal;
    compareAtPrice: Prisma.Decimal | null;
    /** The product's primary image, or null if none is flagged primary. */
    image: string | null;
}

/**
 * A banner as publicly served. `resolvedPrice`/`resolvedDiscountPrice` come from
 * the linked product when there is one, otherwise from the banner's own columns
 * (see banner.service.ts `toPublicBanner`). Both are Decimal, so they serialize
 * to strings in JSON — a consumer must not assume numbers.
 */
export interface IPublicBanner extends Omit<Banner, "productId"> {
    productId: string | null;
    resolvedLink: string | null;
    resolvedPrice: Prisma.Decimal | null;
    resolvedDiscountPrice: Prisma.Decimal | null;
    product: IBannerProductSummary | null;
}
