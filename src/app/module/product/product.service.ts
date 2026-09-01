import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import {
    AuditAction,
    CampaignPlacement,
    Prisma,
    ProductStatus,
} from "../../../generated/prisma/client";
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
    ISearchedProduct,
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

/**
 * Every product scalar a PUBLIC response may carry.
 *
 * Spelled out as a `select` because `include` returns every scalar column, and
 * one of them — `costPrice` — is the supplier cost. It has never been rendered
 * by the storefront, but it was being sent to every anonymous caller: the same
 * column the public `sortBy` allowlist exists to protect, handed over directly.
 * Closing the ordering channel while leaving the field in the payload would
 * have been a lock beside an open window.
 *
 * This is an allowlist, so a column added to `Product` later is private until
 * someone deliberately adds it here. The admin reads keep using the `include`
 * forms above — an admin is entitled to every column.
 */
const PUBLIC_PRODUCT_SCALARS = {
    id: true,
    name: true,
    slug: true,
    sku: true,
    description: true,
    shortDescription: true,
    type: true,
    status: true,
    categoryId: true,
    brandId: true,
    price: true,
    compareAtPrice: true,
    stockQuantity: true,
    lowStockThreshold: true,
    weight: true,
    isFeatured: true,
    averageRating: true,
    reviewCount: true,
    totalSold: true,
    seoTitle: true,
    seoDescription: true,
    createdAt: true,
    updatedAt: true,
} as const;

/**
 * Public list projection: the safe scalars plus the relations a card renders.
 *
 * Deliberately does NOT carry each image's `variantId`: a card shows one
 * primary image and has no variant selector, so the association would be dead
 * weight on every row of every listing. Same for `PRODUCT_LIST_INCLUDE` and
 * `searchProducts`' raw-SQL image subquery.
 * See link-product-images-to-variants design.md Decision 8.
 */
const PUBLIC_PRODUCT_LIST_SELECT = {
    ...PUBLIC_PRODUCT_SCALARS,
    category: true,
    brand: true,
    images: { where: { isPrimary: true }, take: 1 },
} as const;

/** Public detail projection: as above, plus what a product page renders. */
const PUBLIC_PRODUCT_DETAIL_SELECT = {
    ...PUBLIC_PRODUCT_SCALARS,
    category: true,
    brand: true,
    images: { orderBy: { sortOrder: "asc" as const } },
    // Variants carry their own costPrice, so they are projected too rather
    // than selected wholesale.
    variants: {
        select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            compareAtPrice: true,
            stockQuantity: true,
            attributes: true,
            image: true,
            status: true,
        },
    },
    attributes: true,
    categories: { include: { category: true } },
} as const;

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

/**
 * Rejects an image whose variant reference cannot be honored: a `variantIndex`
 * with no entry at that position in this request's own `variants` array, or a
 * `variantId` that is not one of this product's variants — including one
 * belonging to somebody else's product.
 *
 * Runs alongside the other precondition checks and therefore OUTSIDE the
 * transaction, which is what makes the spec's "the request is rejected and no
 * data is created or modified" true by construction rather than by unwinding.
 * See link-product-images-to-variants design.md Decision 5.
 *
 * `ownVariantIds` is the set of variant ids already belonging to this product
 * — empty on create, where no variant has an id yet.
 */
const ensureVariantReferencesResolve = (
    images: IProductImageInput[],
    variants: IProductVariantInput[] | undefined,
    ownVariantIds: Set<string>,
) => {
    const variantCount = variants?.length ?? 0;

    images.forEach((image, position) => {
        // `variantId` wins when both are present, so it is checked first and
        // `variantIndex` is not consulted at all in that case (Decision 3).
        if (image.variantId !== undefined) {
            if (!ownVariantIds.has(image.variantId)) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Image at position ${position} references variant ${image.variantId}, which does not belong to this product`,
                );
            }
            return;
        }

        if (image.variantIndex !== undefined && image.variantIndex >= variantCount) {
            throw new AppError(
                status.BAD_REQUEST,
                `Image at position ${position} references variant index ${image.variantIndex}, but only ${variantCount} variant(s) were submitted`,
            );
        }
    });
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

/**
 * `variantId` is passed in already resolved rather than read off the image,
 * because resolving a `variantIndex` needs the generated variant ids, which
 * only the caller has. Passing `null` clears an existing association — which
 * is what an image resubmitted with no variant named must do.
 */
const toImageData = (image: IProductImageInput, variantId: string | null = null) => ({
    url: image.url,
    altText: image.altText,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
    variantId,
});

/**
 * Resolves an image's variant reference to a concrete id, given the variant ids
 * created or kept by this request in submission order. `variantId` wins over
 * `variantIndex` (Decision 3); neither present means shared, i.e. `null`.
 *
 * Both forms have already been validated by `ensureVariantReferencesResolve`,
 * so an unresolvable index here would be a bug rather than bad input; it
 * degrades to `null` (shared) rather than throwing mid-transaction.
 */
const resolveImageVariantId = (
    image: IProductImageInput,
    variantIdsByIndex: (string | undefined)[],
): string | null => {
    if (image.variantId !== undefined) {
        return image.variantId;
    }

    if (image.variantIndex !== undefined) {
        return variantIdsByIndex[image.variantIndex] ?? null;
    }

    return null;
};

/**
 * Sets each variant's `image` to its lowest-`sortOrder` linked image, keeping
 * the field the cart and wishlist read in step with the gallery rather than
 * letting the two drift apart. A variant with no linked images is left alone,
 * so an `image` supplied directly by an existing client survives.
 * See link-product-images-to-variants design.md Decision 7.
 */
const syncDerivedVariantImages = async (tx: Prisma.TransactionClient, productId: string) => {
    const variants = await tx.productVariant.findMany({
        where: { productId },
        select: {
            id: true,
            image: true,
            images: {
                orderBy: { sortOrder: "asc" as const },
                take: 1,
                select: { url: true },
            },
        },
    });

    for (const variant of variants) {
        const derived = variant.images[0]?.url;

        // No linked images: leave whatever the payload set. Only a variant that
        // HAS linked images has its `image` overridden by them.
        if (derived === undefined || derived === variant.image) {
            continue;
        }

        await tx.productVariant.update({ where: { id: variant.id }, data: { image: derived } });
    }
};

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

    if (payload.images && payload.images.length > 0) {
        // No variant has an id yet, so only `variantIndex` can resolve here —
        // an explicit `variantId` on create can never name a variant of a
        // product that is about to be created, hence the empty id set.
        ensureVariantReferencesResolve(payload.images, payload.variants, new Set());
    }

    const slug = await generateUniqueSlug(payload.slug || payload.name, (candidate) =>
        prisma.product
            .findUnique({ where: { slug: candidate }, select: { id: true } })
            .then((existing) => Boolean(existing)),
    );

    const { variants, images, attributes, ...rest } = payload;

    /*
     * Two phases, in a transaction: images can only be written once the
     * variants they name exist and have ids, and a failure between the two
     * would otherwise leave a product with variants but no images.
     * See link-product-images-to-variants design.md Decision 4.
     */
    const product = await prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
            data: {
                ...rest,
                slug,
                ...(attributes && attributes.length > 0
                    ? { attributes: { create: attributes.map(toAttributeData) } }
                    : {}),
            },
            select: { id: true },
        });

        /*
         * Variants are created one at a time rather than as a nested `create`
         * so each generated id can be captured at its submitted position.
         * Reading them back afterwards would not work: `createdAt` defaults to
         * now() and rows written inside one transaction can share a timestamp,
         * leaving the order — and therefore every `variantIndex` — undefined.
         */
        const variantIdsByIndex: string[] = [];
        if (variants && variants.length > 0) {
            for (const variant of variants) {
                const createdVariant = await tx.productVariant.create({
                    data: { ...toVariantData(variant), productId: created.id },
                    select: { id: true },
                });
                variantIdsByIndex.push(createdVariant.id);
            }
        }

        if (images && images.length > 0) {
            for (const image of images) {
                await tx.productImage.create({
                    data: {
                        ...toImageData(image, resolveImageVariantId(image, variantIdsByIndex)),
                        productId: created.id,
                    },
                });
            }

            await syncDerivedVariantImages(tx, created.id);
        }

        // OrThrow, not findUnique: the row was created in this transaction, so
        // its absence is impossible rather than a case to handle — and this
        // keeps createProduct's return type non-nullable, as it was before.
        return tx.product.findUniqueOrThrow({
            where: { id: created.id },
            include: PRODUCT_DETAIL_INCLUDE,
        });
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

/**
 * `isFeatured` reaches here as a real boolean, not the query string's
 * "true"/"false" — `publicProductQueryZodSchema` in the controller has already
 * coerced it. Stated explicitly rather than relying on `IQueryParams`'s
 * `[key: string]: string | undefined` index signature, which would silently
 * type it as a string.
 */
type IPublicProductQuery = IQueryParams & { isFeatured?: boolean };

const getPublicProducts = async (queryParams: IPublicProductQuery) => {
    const { category, brand, minPrice, maxPrice, isFeatured } = queryParams;

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

    // The controller's Zod schema has already turned the query string's
    // "true"/"false" into a real boolean, so this compares against `undefined`
    // rather than testing truthiness — `isFeatured=false` must filter to
    // non-featured products, not be discarded as falsy.
    if (isFeatured !== undefined) {
        where.isFeatured = isFeatured;
    }

    if (minPrice || maxPrice) {
        where.price = {
            ...(minPrice ? { gte: Number(minPrice) } : {}),
            ...(maxPrice ? { lte: Number(maxPrice) } : {}),
        };
    }

    const { data, meta } = await queryBuilder.where(where).select(PUBLIC_PRODUCT_LIST_SELECT).execute();

    return { data: await attachCampaignPricing(data), meta };
};

/**
 * How many suggestions a search may return, whatever the client asks for.
 *
 * Enforced server-side rather than trusted from the query string: this is a
 * public unauthenticated endpoint, so an uncapped limit turns it into a way to
 * dump the catalog and to make the database sort unbounded work per request.
 */
export const SEARCH_RESULT_CAP = 8;

/**
 * Relevance weights for product search, graded so ranking is explainable and
 * retunable without touching the endpoint's contract.
 *
 * The gap between the exact tiers (0.5–1.0) and the similarity tiers (≤0.4) is
 * load-bearing, not cosmetic: it is what guarantees an approximate match can
 * never outrank an exact one, satisfying the spec's "exact matches are
 * preferred" through arithmetic rather than through a second query.
 */
const SEARCH_WEIGHTS = {
    exactName: 1.0,
    namePrefix: 0.9,
    nameSubstring: 0.8,
    sku: 0.75,
    brand: 0.7,
    description: 0.5,
    /** Multipliers on pg_trgm's 0–1 similarity, keeping fuzzy hits below every exact tier. */
    nameSimilarity: 0.4,
    brandSimilarity: 0.35,
} as const;

/**
 * Renders a weight as a typed SQL literal.
 *
 * These cannot be passed as query parameters: Postgres infers the type of an
 * untyped parameter from its context, and inside a `CASE` arm it settles on
 * `integer`, then rejects `0.9` outright ("invalid input syntax for type
 * integer"). Casting to `numeric` at the call site settles the type instead.
 *
 * Safe to inline because every value is a hard-coded number from the constant
 * above — never user input. `Number.isFinite` is a guard against a future edit
 * introducing something that is not, since string-building SQL is exactly the
 * shape that becomes an injection when the input stops being trusted.
 */
const weight = (value: number): Prisma.Sql => {
    if (!Number.isFinite(value)) {
        throw new Error(`Invalid search weight: ${value}`);
    }
    return Prisma.raw(`${value}::numeric`);
};

/**
 * Product suggestions for search-as-you-type.
 *
 * One database round trip by design. The listing endpoint spends ~1.5s on this
 * job (count + findMany with category/brand/image joins, then a separate
 * campaign-pricing query, all against a Singapore-hosted database where each
 * trip costs ~75ms); this returns the same answer in roughly one trip because
 * it makes exactly one, and carries back only what a dropdown renders.
 *
 * Raw SQL because Prisma cannot express any of what makes this work: the
 * trigram operators, a computed relevance score, or ordering by that score.
 * Approximating it through the query builder would mean several queries plus
 * in-process sorting — precisely the sequential round trips being removed here.
 *
 * `term` is interpolated through Prisma's tagged template, which parameterises
 * rather than concatenates, so a search term cannot become SQL.
 */
const searchProducts = async (term: string, limit?: number): Promise<ISearchedProduct[]> => {
    const trimmed = term.trim();
    if (trimmed.length === 0) {
        return [];
    }

    const take = Math.min(
        Math.max(1, Math.trunc(limit ?? SEARCH_RESULT_CAP)),
        SEARCH_RESULT_CAP,
    );

    const w = SEARCH_WEIGHTS;

    // `score` is selected because ORDER BY needs it, but it is an internal
    // ranking detail rather than part of the endpoint's contract — so it is
    // typed here and stripped before returning.
    // COALESCE on every nullable column (`sku`, `brand.name`, `description`):
    // NULL is not false, and an un-coalesced NULL inside GREATEST would drag
    // the whole score to NULL, silently dropping the row from the ordering.
    const rows = await prisma.$queryRaw<(ISearchedProduct & { score: number })[]>`
        SELECT
            p.id,
            p.name,
            p.slug,
            p.price::text AS price,
            b.name AS "brandName",
            (
                SELECT i.url
                FROM "ProductImage" i
                WHERE i."productId" = p.id
                ORDER BY i."isPrimary" DESC, i."sortOrder" ASC
                LIMIT 1
            ) AS image,
            GREATEST(
                CASE
                    WHEN lower(p.name) = lower(${trimmed}) THEN ${weight(w.exactName)}
                    WHEN lower(p.name) LIKE lower(${trimmed}) || '%' THEN ${weight(w.namePrefix)}
                    WHEN lower(p.name) LIKE '%' || lower(${trimmed}) || '%' THEN ${weight(w.nameSubstring)}
                    ELSE 0::numeric
                END,
                CASE WHEN lower(COALESCE(p.sku, '')) LIKE '%' || lower(${trimmed}) || '%'
                     THEN ${weight(w.sku)} ELSE 0::numeric END,
                CASE WHEN lower(COALESCE(b.name, '')) LIKE '%' || lower(${trimmed}) || '%'
                     THEN ${weight(w.brand)} ELSE 0::numeric END,
                CASE WHEN lower(COALESCE(p.description, '')) LIKE '%' || lower(${trimmed}) || '%'
                     THEN ${weight(w.description)} ELSE 0::numeric END,
                similarity(p.name, ${trimmed})::numeric * ${weight(w.nameSimilarity)},
                similarity(COALESCE(b.name, ''), ${trimmed})::numeric * ${weight(w.brandSimilarity)}
            ) AS score
        FROM "Product" p
        LEFT JOIN "Brand" b ON b.id = p."brandId"
        WHERE p.status = ${ProductStatus.ACTIVE}::"ProductStatus"
          AND (
                lower(p.name) LIKE '%' || lower(${trimmed}) || '%'
             OR lower(COALESCE(p.sku, '')) LIKE '%' || lower(${trimmed}) || '%'
             OR lower(COALESCE(b.name, '')) LIKE '%' || lower(${trimmed}) || '%'
             OR lower(COALESCE(p.description, '')) LIKE '%' || lower(${trimmed}) || '%'
             -- Trigram fallback, in the same clause rather than a second query:
             -- one round trip covers both exact and approximate matching.
             OR p.name % ${trimmed}
             OR COALESCE(b.name, '') % ${trimmed}
          )
        -- The name tiebreak is what makes repeated identical requests return
        -- the same order; score alone would not guarantee it.
        ORDER BY score DESC, p.name ASC
        LIMIT ${take}
    `;

    // `score` drives ORDER BY but is an internal ranking detail, not part of
    // the endpoint's contract — so it is dropped before the rows are returned.
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        price: row.price,
        image: row.image,
        brandName: row.brandName,
    }));
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
        select: PUBLIC_PRODUCT_LIST_SELECT,
    });

    // findMany ignores the order of `in`, so restore the scored ranking.
    const byId = new Map(products.map((product) => [product.id, product]));
    const ordered = ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);

    return attachCampaignPricing(ordered);
};

const getPublicProductBySlug = async (slug: string) => {
    const product = await prisma.product.findFirst({
        where: { slug, status: ProductStatus.ACTIVE },
        select: PUBLIC_PRODUCT_DETAIL_SELECT,
    });

    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    const [withCampaignPricing] = await attachCampaignPricing([product]);
    return withCampaignPricing;
};

/**
 * The campaign occupying a storefront slot, with its products already priced —
 * what `GET /campaigns/active?placement=` serves.
 *
 * Lives here rather than in campaign.service because it needs
 * `attachCampaignPricing`; campaign.service cannot import this module, which
 * already imports it.
 *
 * Returns null for an unoccupied slot rather than throwing: an empty slot is an
 * ordinary state the storefront handles by omitting the section, not an error.
 *
 * The response is deliberately narrow. `discountType`/`discountValue` and the
 * campaign's administrative fields are withheld — a shopper needs the resulting
 * price, which `campaignPrice` on each product already carries, not the rule
 * that produced it. Note that `attachCampaignPricing` attaches the discount
 * rule to every product as `activeCampaign`, so it is stripped below rather
 * than merely not selected. `endsAt` is passed through exactly as stored,
 * including null: a campaign with no deadline must not be given a fabricated
 * one, which is precisely the fiction the old client-side seven-day timer
 * invented.
 */
const getActiveCampaign = async (placement: CampaignPlacement) => {
    const campaign = await CampaignService.getActiveCampaignByPlacement(placement);

    if (!campaign) {
        return null;
    }

    const productIds = campaign.products.map((entry) => entry.productId);

    // A campaign with no products, or whose products have since been archived,
    // is still a campaign — it just has nothing to show. Skip the query rather
    // than issuing `id: { in: [] }`.
    const products =
        productIds.length > 0
            ? await prisma.product.findMany({
                  where: { id: { in: productIds }, status: ProductStatus.ACTIVE },
                  select: PUBLIC_PRODUCT_LIST_SELECT,
              })
            : [];

    const priced = await attachCampaignPricing(products);

    // Drop the discount rule each product carries. `campaignPrice` — the price
    // the shopper actually pays — stays; how it was derived does not need to
    // reach a storefront, and the campaign's identity is already on the
    // envelope above.
    const withoutDiscountConfig = priced.map((product) => {
        const { activeCampaign, ...rest } = product;
        void activeCampaign;
        return rest;
    });

    return {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        placement: campaign.placement,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        products: withoutDiscountConfig,
    };
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
/**
 * Returns the variant id at each submitted position, so an image naming a
 * `variantIndex` can be resolved — including one naming a variant this very
 * call just created. See link-product-images-to-variants design.md Decision 6.
 */
const syncProductVariants = async (
    tx: Prisma.TransactionClient,
    productId: string,
    variants: IProductVariantInput[],
): Promise<string[]> => {
    const existing = await tx.productVariant.findMany({
        where: { productId },
        select: { id: true },
    });
    const existingIds = new Set(existing.map((row) => row.id));
    const keepIds = new Set(variants.filter((v) => v.id).map((v) => v.id as string));

    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length > 0) {
        /*
         * Release this variant's images before deleting it, so removing a
         * variant never destroys photography — the images become shared across
         * the product instead. The FK is ON DELETE SET NULL and would do this
         * anyway; it is spelled out here so the intent survives a future
         * schema edit that changes the FK.
         * See link-product-images-to-variants design.md Decision 2.
         */
        await tx.productImage.updateMany({
            where: { variantId: { in: toDelete } },
            data: { variantId: null },
        });
        await tx.productVariant.deleteMany({ where: { id: { in: toDelete } } });
    }

    const variantIdsByIndex: string[] = [];

    for (const variant of variants) {
        if (variant.id) {
            if (!existingIds.has(variant.id)) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `Variant ${variant.id} does not belong to this product`,
                );
            }
            await tx.productVariant.update({ where: { id: variant.id }, data: toVariantData(variant) });
            variantIdsByIndex.push(variant.id);
        } else {
            const created = await tx.productVariant.create({
                data: { ...toVariantData(variant), productId },
                select: { id: true },
            });
            variantIdsByIndex.push(created.id);
        }
    }

    return variantIdsByIndex;
};

/**
 * `variantIdsByIndex` comes from `syncProductVariants` and MUST reflect the
 * post-sync variant set — which is why variants are synced first in
 * `updateProduct`'s transaction (design.md Decision 6).
 *
 * Each image's association is rewritten on every sync, so resubmitting an
 * image with no variant named clears it rather than leaving the old value.
 */
const syncProductImages = async (
    tx: Prisma.TransactionClient,
    productId: string,
    images: IProductImageInput[],
    variantIdsByIndex: string[] = [],
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
            await tx.productImage.update({
                where: { id: image.id },
                data: toImageData(image, resolveImageVariantId(image, variantIdsByIndex)),
            });
        } else {
            await tx.productImage.create({
                data: {
                    ...toImageData(image, resolveImageVariantId(image, variantIdsByIndex)),
                    productId,
                },
            });
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

    if (payload.images && payload.images.length > 0) {
        /*
         * A `variantId` is valid if it names a variant this product actually
         * has. Variants surviving this update are the ones resubmitted with an
         * id; a variant the payload drops is being deleted, so an image may not
         * point at it. When the payload omits `variants` entirely the existing
         * variants are untouched, so all of them remain referenceable.
         */
        const survivingVariantIds = payload.variants
            ? new Set(payload.variants.filter((v) => v.id).map((v) => v.id as string))
            : new Set(
                  (
                      await prisma.productVariant.findMany({
                          where: { productId: id },
                          select: { id: true },
                      })
                  ).map((variant) => variant.id),
              );

        ensureVariantReferencesResolve(payload.images, payload.variants, survivingVariantIds);
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

        /*
         * Variants MUST be synced before images: an image may name a variant by
         * the position it occupies in this request, including one created by
         * the very call above. Reordering these two silently mis-assigns those
         * images. See link-product-images-to-variants design.md Decision 6.
         */
        let variantIdsByIndex: string[] = [];
        if (variants) {
            variantIdsByIndex = await syncProductVariants(tx, id, variants);
        }

        if (images) {
            if (!variants) {
                // No `variants` submitted means the existing set is untouched,
                // so a `variantIndex` refers to a position within that set.
                const current = await tx.productVariant.findMany({
                    where: { productId: id },
                    orderBy: { createdAt: "asc" as const },
                    select: { id: true },
                });
                variantIdsByIndex = current.map((variant) => variant.id);
            }

            await syncProductImages(tx, id, images, variantIdsByIndex);
            await syncDerivedVariantImages(tx, id);
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
    getActiveCampaign,
    searchProducts,
    getPublicProductBySlug,
    getRelatedProducts,
    getAdminProducts,
    getAdminProductById,
    updateProduct,
    deleteProduct,
    addProductCategory,
    removeProductCategory,
};
