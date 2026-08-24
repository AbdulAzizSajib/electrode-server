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
