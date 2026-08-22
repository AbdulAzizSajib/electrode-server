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
}

export type IUpdateProductPayload = Partial<ICreateProductPayload>;
