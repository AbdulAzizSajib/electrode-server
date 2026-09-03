import { Prisma } from "../../../generated/prisma/client";

/**
 * Which shop-wide attribute a product sells, and which of its values.
 *
 * A product no longer defines options; it selects from attributes that already
 * exist. So this names an attribute and the subset of its values this product
 * stocks — a shop-wide Colour may have six values while a given product sells
 * two of them.
 *
 * Order is positional: the `i`-th entry here is the `i`-th option on the
 * product, and `valueIds[j]` is the `j`-th value of it. A variant's
 * `optionValueIndexes` index into exactly those positions.
 */
export interface IProductOptionInput {
    attributeId: string;
    /** Ids of the values this product sells, in the order to present them. */
    valueIds: string[];
    /** Optional, for error messages only — the attribute's own name is authoritative. */
    name?: string;
}

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
    /**
     * Which option value this variant selects, per option, by position:
     * `optionValueIndexes[i]` is the index into `options[i].values`.
     *
     * Positional for the same reason images use `variantIndex` — on create no
     * option value has an id yet, so there is nothing else to name it by. A
     * variant must supply exactly one entry per option of its product, which is
     * the invariant the whole model rests on.
     */
    optionValueIndexes?: number[];
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
    taxRuleId?: string;
    shippingRuleId?: string;
    /** Null clears the offer; omitted leaves it as it was. */
    bundleDealId?: string | null;

    unit?: string;
    badge?: string;
    /** Null means the merchant has not said — different from "No". */
    isRefundable?: boolean | null;
    hasWarranty?: boolean | null;
    video?: string | null;
    videoThumbnail?: string | null;

    /** The full intended set of collection memberships; omitted leaves them alone. */
    collectionIds?: string[];
    /** The full intended set of keywords, created on demand. */
    tags?: string[];

    options?: IProductOptionInput[];
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
