import { Prisma } from "../../../generated/prisma/client";

export interface IProductVariantInput {
    /** Present on update to target an existing variant; omitted to create a new one. */
    id?: string;
    name: string;
    sku: string;
    price?: number;
    compareAtPrice?: number;
    costPrice?: number;
    stockQuantity?: number;
    attributes?: Prisma.InputJsonValue;
    image?: string;
    status?: boolean;
}

export interface IProductImageInput {
    id?: string;
    url: string;
    altText?: string;
    sortOrder?: number;
    isPrimary?: boolean;
    /**
     * The variant this image depicts, by id. Omitting both this and
     * `variantIndex` means the image is shared across every variant.
     * Takes precedence when both are present.
     */
    variantId?: string;
    /**
     * The variant this image depicts, by position in the SAME request's
     * `variants` array — the only way to name a variant that does not exist
     * yet, which on create is every variant. Ignored when `variantId` is set.
     * See link-product-images-to-variants design.md Decision 3.
     */
    variantIndex?: number;
}

export interface IProductAttributeInput {
    id?: string;
    name: string;
    value: string;
}

/**
 * Describes an uploaded file's metadata by position (the `i`-th slot
 * matches the `i`-th multipart `images` file) — never persisted itself,
 * consumed only by the controller to build `IProductImageInput` entries
 * for freshly-uploaded files. See add-product-image-upload design.md
 * Decision 1.
 */
export interface IImageSlotInput {
    altText?: string;
    sortOrder?: number;
    isPrimary?: boolean;
    /** See `IProductImageInput.variantId` — carried onto the built image input. */
    variantId?: string;
    /** See `IProductImageInput.variantIndex` — carried onto the built image input. */
    variantIndex?: number;
}

export interface ICreateProductPayload {
    name: string;
    slug?: string;
    sku?: string;
    description?: string;
    shortDescription?: string;
    type?: "SIMPLE" | "VARIABLE";
    status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
    categoryId?: string;
    brandId?: string;
    price: number;
    compareAtPrice?: number;
    costPrice?: number;
    stockQuantity?: number;
    lowStockThreshold?: number;
    weight?: number;
    isFeatured?: boolean;
    seoTitle?: string;
    seoDescription?: string;
    variants?: IProductVariantInput[];
    images?: IProductImageInput[];
    attributes?: IProductAttributeInput[];
    /** Consumed by the controller only — see `IImageSlotInput`. Never read by product.service.ts. */
    imageSlots?: IImageSlotInput[];
}

export type IUpdateProductPayload = Partial<ICreateProductPayload>;

/**
 * One suggestion from `GET /products/search`.
 *
 * Deliberately narrow: a search-as-you-type dropdown needs a label, a link
 * target, a price and a thumbnail — nothing else. The category object, brand
 * object and campaign pricing that `GET /products` returns are what make that
 * endpoint slow, and none of them are rendered in a suggestion list. What this
 * type leaves out is the point of the endpoint.
 */
export interface ISearchedProduct {
    id: string;
    name: string;
    slug: string;
    /** Prisma returns Decimal columns as strings; kept as-is, like every other product payload. */
    price: string;
    /** Primary image url, or null when the product has no images. */
    image: string | null;
    /** Brand name only — not the brand record. Null when the product has no brand. */
    brandName: string | null;
}
