import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, Prisma, ProductStatus } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { generateUniqueSlug } from "../../utils/slug";
import { AuditLogService } from "../audit-log/audit-log.service";
import { CampaignService } from "../campaign/campaign.service";
import {
    ICreateProductPayload,
    IProductAttributeInput,
    IProductImageInput,
    IProductVariantInput,
    IUpdateProductPayload,
} from "./product.interface";

const PRODUCT_DETAIL_INCLUDE = {
    category: true,
    brand: true,
    images: { orderBy: { sortOrder: "asc" as const } },
    variants: true,
    attributes: true,
    categories: { include: { category: true } },
};

const PRODUCT_LIST_INCLUDE = {
    category: true,
    brand: true,
    images: { where: { isPrimary: true }, take: 1 },
};

const assertCategoryExists = async (categoryId: string) => {
    const category = await prisma.category.findUnique({
        where: { id: categoryId },
        select: { id: true },
    });

    if (!category) {
        throw new AppError(status.BAD_REQUEST, "Category not found");
    }
};

const assertBrandExists = async (brandId: string) => {
    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });

    if (!brand) {
        throw new AppError(status.BAD_REQUEST, "Brand not found");
    }
};

const ensureUniqueProductSku = async (sku: string, excludeId?: string) => {
    const existing = await prisma.product.findFirst({
        where: { sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, `SKU "${sku}" is already in use`);
    }
};

/** Rejects duplicate SKUs within the payload itself, and SKUs already used by another product's variants. */
const ensureUniqueVariantSkus = async (variants: IProductVariantInput[], ownVariantIds: Set<string>) => {
    const skus = variants.map((v) => v.sku);
    if (new Set(skus).size !== skus.length) {
        throw new AppError(status.BAD_REQUEST, "Duplicate variant SKUs in request");
    }

    for (const variant of variants) {
        const conflict = await prisma.productVariant.findUnique({
            where: { sku: variant.sku },
            select: { id: true },
        });

        if (conflict && !ownVariantIds.has(conflict.id)) {
            throw new AppError(status.CONFLICT, `Variant SKU "${variant.sku}" is already in use`);
        }
    }
};

const toVariantData = (variant: IProductVariantInput) => ({
    name: variant.name,
    sku: variant.sku,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    costPrice: variant.costPrice,
    stockQuantity: variant.stockQuantity,
    attributes: variant.attributes,
    image: variant.image,
    status: variant.status,
});

const toImageData = (image: IProductImageInput) => ({
    url: image.url,
    altText: image.altText,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
});

const toAttributeData = (attribute: IProductAttributeInput) => ({
    name: attribute.name,
    value: attribute.value,
});

const createProduct = async (userId: string, payload: ICreateProductPayload) => {
    if (payload.categoryId) {
        await assertCategoryExists(payload.categoryId);
    }

    if (payload.brandId) {
        await assertBrandExists(payload.brandId);
    }

    if (payload.sku) {
        await ensureUniqueProductSku(payload.sku);
    }

    if (payload.variants && payload.variants.length > 0) {
        await ensureUniqueVariantSkus(payload.variants, new Set());
    }

    const slug = await generateUniqueSlug(payload.slug || payload.name, (candidate) =>
        prisma.product
            .findUnique({ where: { slug: candidate }, select: { id: true } })
            .then((existing) => Boolean(existing)),
    );

    const { variants, images, attributes, ...rest } = payload;

    const product = await prisma.product.create({
        data: {
            ...rest,
            slug,
            ...(variants && variants.length > 0
                ? { variants: { create: variants.map(toVariantData) } }
                : {}),
            ...(images && images.length > 0 ? { images: { create: images.map(toImageData) } } : {}),
            ...(attributes && attributes.length > 0
                ? { attributes: { create: attributes.map(toAttributeData) } }
                : {}),
        },
        include: PRODUCT_DETAIL_INCLUDE,
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "Product", product.id, {
        newData: product,
    });

    return product;
};

/**
 * Attaches each product's best currently-active campaign discount (Phase 6)
 * as `campaignPrice`/`activeCampaign` — `null` when no campaign applies.
 * Per `api/marketing` spec this is automatic on read, not a separate
 * customer-facing endpoint or action.
 */
const attachCampaignPricing = async <T extends { id: string; price: Prisma.Decimal }>(
    products: T[],
) => {
    const priceByProductId = new Map(products.map((p) => [p.id, Number(p.price)]));
    const discounts = await CampaignService.getActiveDiscountsForProducts(
        products.map((p) => p.id),
        priceByProductId,
    );

    return products.map((product) => {
        const discount = discounts.get(product.id);
        if (!discount) {
            return { ...product, campaignPrice: null, activeCampaign: null };
        }

        const basePrice = Number(product.price);
        const campaignPrice =
            discount.discountType === "PERCENTAGE"
                ? basePrice * (1 - discount.discountValue / 100)
                : Math.max(0, basePrice - discount.discountValue);

        return { ...product, campaignPrice, activeCampaign: discount };
    });
};

/**
 * Returns `categoryId` plus every category beneath it, at any depth, so that
 * filtering by a parent category also returns the products of its children
 * (e.g. "Audio & Smart Ecosystems" yields TWS Earbuds products too).
 *
 * Walks the tree one level at a time — Prisma cannot `include` a recursive
 * relation to arbitrary depth, mirroring the approach in
 * `CategoryService.getAdminCategoryTree`. `visited` guards against a cyclic
 * hierarchy so the loop always terminates.
 */
const collectCategoryIds = async (categoryId: string): Promise<string[]> => {
    const visited = new Set<string>([categoryId]);
    let frontier = [categoryId];

    while (frontier.length > 0) {
        const children = await prisma.category.findMany({
            where: { parentId: { in: frontier } },
            select: { id: true },
        });

        frontier = children.map((child) => child.id).filter((id) => !visited.has(id));
        frontier.forEach((id) => visited.add(id));
    }

    return [...visited];
};

const getPublicProducts = async (queryParams: IQueryParams) => {
    const { category, brand, minPrice, maxPrice } = queryParams;

    const queryBuilder = new QueryBuilder<
        Prisma.ProductGetPayload<{
            include: { category: true; brand: true; images: { where: { isPrimary: true }; take: 1 } };
        }>
    >(prisma.product, queryParams, {
        searchableFields: ["name", "description", "shortDescription"],
    });

    queryBuilder.search().sort().paginate();

    const where: Record<string, unknown> = { status: ProductStatus.ACTIVE };

    // Note: uses `AND` (not `OR`) as the top-level key so it composes safely
    // with `search()`'s own `OR` (search-term) condition instead of
    // clobbering it — QueryBuilder.where() only deep-merges, it doesn't
    // union sibling `OR` arrays.
    if (category) {
        // Includes descendant categories, so a parent id returns the whole
        // subtree's products; a leaf id resolves to just itself.
        const categoryIds = await collectCategoryIds(category);

        where.AND = [
            {
                OR: [
                    { categoryId: { in: categoryIds } },
                    { categories: { some: { categoryId: { in: categoryIds } } } },
                ],
            },
        ];
    }

    if (brand) {
        where.brandId = brand;
    }

    if (minPrice || maxPrice) {
        where.price = {
            ...(minPrice ? { gte: Number(minPrice) } : {}),
            ...(maxPrice ? { lte: Number(maxPrice) } : {}),
        };
    }

    const { data, meta } = await queryBuilder.where(where).include(PRODUCT_LIST_INCLUDE).execute();

    return { data: await attachCampaignPricing(data), meta };
};

/**
 * Relatedness weights. Tuned so a rival brand's product in the SAME category
 * (3 + maybe 1 for price = 3-4) outranks the SAME brand's product from a
 * different category (2) — on a headphone page a shopper wants other
 * headphones, not that brand's charger.
 *
 * These are guesses until there is traffic to tune them against; they are
 * deliberately constants in one place so tuning never touches the endpoint
 * contract.
 */
const RELATED_SCORE_SAME_CATEGORY = 3;
const RELATED_SCORE_SAME_BRAND = 2;
const RELATED_SCORE_SHARED_CATEGORY = 1;
const RELATED_SCORE_PRICE_BAND = 1;
/** Wide enough to relate a mid-range and a premium headphone, narrow enough to exclude a cheap cable. */
const RELATED_PRICE_BAND = 0.4;
const RELATED_DEFAULT_LIMIT = 6;
const RELATED_MAX_LIMIT = 24;

/**
 * Products related to `slug`, ranked by catalog structure alone (no order
 * history, no admin curation — see design.md Non-Goals).
 *
 * Scored in SQL rather than as several OR'ed Prisma queries merged in JS,
 * because the merge would lose the ranking. Only the source product's own
 * columns and a clamped integer limit are interpolated, all as bound
 * parameters.
 */
const getRelatedProducts = async (slug: string, limit?: number) => {
    const source = await prisma.product.findFirst({
        where: { slug, status: ProductStatus.ACTIVE },
        select: { id: true, categoryId: true, brandId: true, price: true },
    });

    if (!source) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    const take = Math.min(Math.max(Number(limit) || RELATED_DEFAULT_LIMIT, 1), RELATED_MAX_LIMIT);

    const basePrice = Number(source.price);
    const minPrice = basePrice * (1 - RELATED_PRICE_BAND);
    const maxPrice = basePrice * (1 + RELATED_PRICE_BAND);

    const scored = await prisma.$queryRaw<{ id: string }[]>`
        SELECT p."id"
        FROM "Product" p
        WHERE p."status" = 'ACTIVE'
          AND p."id" <> ${source.id}
        ORDER BY (
            CASE WHEN ${source.categoryId}::text IS NOT NULL AND p."categoryId" = ${source.categoryId}
                 THEN ${RELATED_SCORE_SAME_CATEGORY} ELSE 0 END
          + CASE WHEN ${source.brandId}::text IS NOT NULL AND p."brandId" = ${source.brandId}
                 THEN ${RELATED_SCORE_SAME_BRAND} ELSE 0 END
          + CASE WHEN EXISTS (
                    SELECT 1 FROM "ProductCategory" pc
                    JOIN "ProductCategory" spc ON spc."categoryId" = pc."categoryId"
                    WHERE pc."productId" = p."id" AND spc."productId" = ${source.id}
                 ) THEN ${RELATED_SCORE_SHARED_CATEGORY} ELSE 0 END
          + CASE WHEN p."price" BETWEEN ${minPrice} AND ${maxPrice}
                 THEN ${RELATED_SCORE_PRICE_BAND} ELSE 0 END
        ) DESC,
        p."isFeatured" DESC,
        p."createdAt" DESC
        LIMIT ${take}
    `;

    // The scoring query is ordered but always returns `take` rows, including
    // zero-scoring ones — that IS the backfill: an isolated product still gets
    // a useful list drawn from the wider catalog (featured, then newest),
    // rather than an empty one.
    const ids = scored.map((row) => row.id);

    if (ids.length === 0) {
        return [];
    }

    const products = await prisma.product.findMany({
        where: { id: { in: ids } },
        include: PRODUCT_LIST_INCLUDE,
    });

    // findMany ignores the order of `in`, so restore the scored ranking.
    const byId = new Map(products.map((product) => [product.id, product]));
    const ordered = ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);

    return attachCampaignPricing(ordered);
};

const getPublicProductBySlug = async (slug: string) => {
    const product = await prisma.product.findFirst({
        where: { slug, status: ProductStatus.ACTIVE },
        include: PRODUCT_DETAIL_INCLUDE,
    });

    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    const [withCampaignPricing] = await attachCampaignPricing([product]);
    return withCampaignPricing;
};

const getAdminProducts = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.product, queryParams, {
        searchableFields: ["name", "sku", "description"],
        filterableFields: ["status", "type", "categoryId", "brandId", "isFeatured"],
    });

    return queryBuilder
        .search()
        .filter()
        .sort()
        .paginate()
        .include(PRODUCT_LIST_INCLUDE)
        .execute();
};

const getAdminProductById = async (id: string) => {
    const product = await prisma.product.findUnique({
        where: { id },
        include: PRODUCT_DETAIL_INCLUDE,
    });

    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    return product;
};

/**
 * Reconciles a nested child collection (variants/images/attributes) against
 * `items` from the update payload: items with an `id` belonging to this
 * product are updated, items without an `id` are created, and existing rows
 * not represented in `items` are deleted. Mirrors "nested ... create-update"
 * from tasks.md 1.3.
 */
/**
 * Reconciles a nested child collection (variant/image/attribute) against the
 * update payload: items with an `id` belonging to this product are updated,
 * items without an `id` are created, and existing rows not represented in
 * the payload are deleted. Mirrors "nested ... create-update" from
 * tasks.md 1.3. Kept as three concrete functions (rather than one generic
 * one) so each stays type-safe against its own Prisma delegate.
 */
const syncProductVariants = async (
    tx: Prisma.TransactionClient,
    productId: string,
    variants: IProductVariantInput[],
) => {
    const existing = await tx.productVariant.findMany({
        where: { productId },
        select: { id: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));
    const keepIds = new Set(variants.filter((v) => v.id).map((v) => v.id as string));

    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length > 0) {
        await tx.productVariant.deleteMany({ where: { id: { in: toDelete } } });
    }

    for (const variant of variants) {
        if (variant.id) {
            if (!existingIds.has(variant.id)) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Variant ${variant.id} does not belong to this product`,
                );
            }
            await tx.productVariant.update({ where: { id: variant.id }, data: toVariantData(variant) });
        } else {
            await tx.productVariant.create({ data: { ...toVariantData(variant), productId } });
        }
    }
};

const syncProductImages = async (
    tx: Prisma.TransactionClient,
    productId: string,
    images: IProductImageInput[],
) => {
    const existing = await tx.productImage.findMany({
        where: { productId },
        select: { id: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));
    const keepIds = new Set(images.filter((i) => i.id).map((i) => i.id as string));

    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length > 0) {
        await tx.productImage.deleteMany({ where: { id: { in: toDelete } } });
    }

    for (const image of images) {
        if (image.id) {
            if (!existingIds.has(image.id)) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Image ${image.id} does not belong to this product`,
                );
            }
            await tx.productImage.update({ where: { id: image.id }, data: toImageData(image) });
        } else {
            await tx.productImage.create({ data: { ...toImageData(image), productId } });
        }
    }
};

const syncProductAttributes = async (
    tx: Prisma.TransactionClient,
    productId: string,
    attributes: IProductAttributeInput[],
) => {
    const existing = await tx.productAttribute.findMany({
        where: { productId },
        select: { id: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));
    const keepIds = new Set(attributes.filter((a) => a.id).map((a) => a.id as string));

    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length > 0) {
        await tx.productAttribute.deleteMany({ where: { id: { in: toDelete } } });
    }

    for (const attribute of attributes) {
        if (attribute.id) {
            if (!existingIds.has(attribute.id)) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Attribute ${attribute.id} does not belong to this product`,
                );
            }
            await tx.productAttribute.update({
                where: { id: attribute.id },
                data: toAttributeData(attribute),
            });
        } else {
            await tx.productAttribute.create({ data: { ...toAttributeData(attribute), productId } });
        }
    }
};

const updateProduct = async (userId: string, id: string, payload: IUpdateProductPayload) => {
    const existing = await prisma.product.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    if (payload.categoryId) {
        await assertCategoryExists(payload.categoryId);
    }

    if (payload.brandId) {
        await assertBrandExists(payload.brandId);
    }

    if (payload.sku && payload.sku !== existing.sku) {
        await ensureUniqueProductSku(payload.sku, id);
    }

    if (payload.variants && payload.variants.length > 0) {
        const ownVariantIds = new Set(
            payload.variants.filter((v) => v.id).map((v) => v.id as string),
        );
        await ensureUniqueVariantSkus(payload.variants, ownVariantIds);
    }

    let slug = existing.slug;
    if (payload.slug || (payload.name && payload.name !== existing.name)) {
        slug = await generateUniqueSlug(payload.slug || payload.name || existing.name, (candidate) =>
            prisma.product
                .findFirst({ where: { slug: candidate, id: { not: id } }, select: { id: true } })
                .then((found) => Boolean(found)),
        );
    }

    const { variants, images, attributes, ...rest } = payload;

    const updated = await prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id }, data: { ...rest, slug } });

        if (variants) {
            await syncProductVariants(tx, id, variants);
        }

        if (images) {
            await syncProductImages(tx, id, images);
        }

        if (attributes) {
            await syncProductAttributes(tx, id, attributes);
        }

        return tx.product.findUnique({ where: { id }, include: PRODUCT_DETAIL_INCLUDE });
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Product", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

/**
 * Deletes a product, or archives it when historical records depend on it.
 *
 * `OrderItem` and `PurchaseOrderItem` both reference Product with the default
 * `Restrict`, deliberately: hard-deleting a product that appears on a past
 * order or purchase order would corrupt the financial history those rows
 * represent. So when either exists we soft-delete instead — set the status to
 * ARCHIVED, which already hides the product from every public query — and
 * report back which path was taken so the caller can phrase its response.
 */
const deleteProduct = async (userId: string, id: string) => {
    const existing = await prisma.product.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    const [orderItemCount, purchaseOrderItemCount] = await Promise.all([
        prisma.orderItem.count({ where: { productId: id } }),
        prisma.purchaseOrderItem.count({ where: { productId: id } }),
    ]);

    if (orderItemCount > 0 || purchaseOrderItemCount > 0) {
        if (existing.status === ProductStatus.ARCHIVED) {
            return { product: existing, archived: true as const, orderItemCount, purchaseOrderItemCount };
        }

        const archived = await prisma.product.update({
            where: { id },
            data: { status: ProductStatus.ARCHIVED },
        });

        // Recorded as UPDATE, not DELETE: the row survives. The status change
        // from oldData -> newData is what makes the archival auditable.
        await AuditLogService.record(userId, AuditAction.UPDATE, "Product", id, {
            oldData: existing,
            newData: archived,
        });

        return { product: archived, archived: true as const, orderItemCount, purchaseOrderItemCount };
    }

    const deleted = await prisma.product.delete({ where: { id } });
    await AuditLogService.record(userId, AuditAction.DELETE, "Product", id, { oldData: existing });

    return { product: deleted, archived: false as const, orderItemCount, purchaseOrderItemCount };
};

const addProductCategory = async (productId: string, categoryId: string) => {
    const [product, category] = await Promise.all([
        prisma.product.findUnique({ where: { id: productId }, select: { id: true } }),
        prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } }),
    ]);

    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }
    if (!category) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }

    const existing = await prisma.productCategory.findUnique({
        where: { productId_categoryId: { productId, categoryId } },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, "Product is already tagged with this category");
    }

    return prisma.productCategory.create({ data: { productId, categoryId } });
};

const removeProductCategory = async (productId: string, categoryId: string) => {
    const existing = await prisma.productCategory.findUnique({
        where: { productId_categoryId: { productId, categoryId } },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Product is not tagged with this category");
    }

    return prisma.productCategory.delete({
        where: { productId_categoryId: { productId, categoryId } },
    });
};

export const ProductService = {
    createProduct,
    getPublicProducts,
    getPublicProductBySlug,
    getRelatedProducts,
    getAdminProducts,
    getAdminProductById,
    updateProduct,
    deleteProduct,
    addProductCategory,
    removeProductCategory,
};
