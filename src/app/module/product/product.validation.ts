import z from "zod";

/**
 * Which shop-wide attribute this product sells, and which of its values.
 *
 * The product does not define the attribute — it selects one that already
 * exists, and a subset of its values. The service checks that every value named
 * really belongs to the attribute named; this only rejects nonsense.
 * See align-admin-catalog-with-reference design.md.
 */
const productOptionZodSchema = z.object({
    attributeId: z.string().min(1, "An option must name an attribute"),
    valueIds: z
        .array(z.string().min(1))
        .min(1, "Select at least one value for each attribute"),
    name: z.string().max(100).optional(),
});

/**
 * The rule relating the three prices, applied wherever they are authored.
 *
 * `sellingPrice` is the regular price shown struck through, so a value below
 * `offerPrice` would render a "was" cheaper than the "now" — backwards, and
 * exactly the mistake the old Shopify-style names invited. `offerPrice` at or
 * below `purchasePrice` is a sale at a loss, which is never what a merchant
 * filling in a form meant to type.
 *
 * Both errors name the two fields involved: told only "prices are
 * inconsistent", a merchant cannot tell which of two numbers to change. The
 * issue is attached to the field the merchant is most likely to want to
 * correct.
 *
 * Absent values are skipped rather than treated as zero — on an update the
 * caller may be sending one price and leaving the others alone. The service
 * merges a partial payload over the stored row before validating, so a rule
 * that looks unenforced here is still enforced there. See design.md Decision 5.
 */
const addPriceConsistencyIssues = (
    prices: { offerPrice?: number | null; sellingPrice?: number | null; purchasePrice?: number | null },
    ctx: z.RefinementCtx,
    path: (string | number)[] = [],
) => {
    const { offerPrice, sellingPrice, purchasePrice } = prices;

    if (offerPrice == null) return;

    if (sellingPrice != null && sellingPrice < offerPrice) {
        ctx.addIssue({
            code: "custom",
            path: [...path, "sellingPrice"],
            message: `Regular price (${sellingPrice}) cannot be below the offer price (${offerPrice}). The regular price is the higher, struck-through one.`,
        });
    }

    if (purchasePrice != null && offerPrice <= purchasePrice) {
        ctx.addIssue({
            code: "custom",
            path: [...path, "offerPrice"],
            message: `Offer price (${offerPrice}) must be above the purchase price (${purchasePrice}) — otherwise this product sells at a loss.`,
        });
    }
};

const productVariantZodSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(150),
    sku: z.string().min(1).max(100),
    /** All three optional: absent means the variant is priced by its product. */
    offerPrice: z.number().nonnegative().optional(),
    sellingPrice: z.number().nonnegative().optional(),
    purchasePrice: z.number().nonnegative().optional(),
    /*
     * No `stockQuantity` here, and none on the product below. A variant's stock
     * is owned by the `Stock` ledger and only ever moves through a
     * `StockMovement` — receive a purchase order, adjust stock, or sell one.
     * Accepting it here let the catalog assert a quantity no ledger row backed,
     * so the storefront advertised stock that checkout then rejected.
     * See remove-catalog-authored-stock design.md.
     */
    attributes: z.record(z.string(), z.unknown()).optional(),
    image: z.url("Variant image must be a valid URL").optional(),
    status: z.boolean().optional(),
    /**
     * One index per option, into that option's `values` — positional because on
     * create no value has an id yet. The service checks arity and range against
     * the submitted options; this only rejects nonsense.
     */
    optionValueIndexes: z.array(z.number().int().nonnegative()).optional(),
});

/**
 * `variantId` / `variantIndex` name the variant an image depicts; omitting both
 * means the image is shared across every variant. `variantId` wins when both
 * are present. `variantIndex` refers to a position in the same request's
 * `variants` array — the only way to name a variant that has no id yet.
 * See link-product-images-to-variants design.md Decision 3.
 */
const productImageZodSchema = z.object({
    id: z.string().optional(),
    url: z.url("Image must be a valid URL"),
    altText: z.string().max(200).optional(),
    sortOrder: z.number().int().optional(),
    isPrimary: z.boolean().optional(),
    variantId: z.string().optional(),
    variantIndex: z.number().int().nonnegative().optional(),
});

/**
 * Describes an uploaded file's metadata by position — the `i`-th entry
 * matches the `i`-th file in the multipart `images` field. See
 * add-product-image-upload design.md Decision 1.
 */
const imageSlotZodSchema = z.object({
    altText: z.string().max(200).optional(),
    sortOrder: z.number().int().optional(),
    isPrimary: z.boolean().optional(),
    // Same meaning as on productImageZodSchema above — the controller copies
    // these onto the image input it builds for the matching file.
    variantId: z.string().optional(),
    variantIndex: z.number().int().nonnegative().optional(),
});

const productAttributeZodSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(100),
    value: z.string().min(1).max(200),
});

const productBaseZodSchema = z.object({
    name: z.string().min(2).max(200),
    slug: z.string().min(2).max(220).optional(),
    sku: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    shortDescription: z.string().max(500).optional(),
    type: z.enum(["SIMPLE", "VARIABLE"]).optional(),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
    categoryId: z.string().optional(),
    brandId: z.string().optional(),
    /** What the shopper is charged — the only price a product must have. */
    offerPrice: z.number().nonnegative(),
    /** The regular price, shown struck through. Omitted when nothing is on offer. */
    sellingPrice: z.number().nonnegative().optional(),
    /** Supplier cost. Admin-only; never reaches a public response. */
    purchasePrice: z.number().nonnegative().optional(),
    /*
     * `stockQuantity` is deliberately absent — see the note on
     * `productVariantZodSchema` above. `lowStockThreshold` stays: it is a
     * setting (when to warn), not a quantity, so nothing else owns it.
     */
    lowStockThreshold: z.number().int().nonnegative().optional(),
    weight: z.number().nonnegative().optional(),
    isFeatured: z.boolean().optional(),
    seoTitle: z.string().max(200).optional(),
    seoDescription: z.string().max(500).optional(),

    /*
     * Which named rule prices this product's tax. Optional here because a
     * product created before rules existed has it backfilled, but the service
     * treats a product without one as incomplete — it cannot be taxed.
     *
     * There is no delivery counterpart. Delivery is a store-wide list the
     * shopper picks from at checkout, so it is not a product field at all.
     */
    taxRuleId: z.string().optional(),
    /** Null clears the offer; omitted leaves it as it was. */
    bundleDealId: z.string().nullable().optional(),

    /** What the product is sold in — "1 kg", "500 ml", "pack of 12". */
    unit: z.string().max(60).optional(),
    /** A short storefront label — "New", "Hot". Presentation only. */
    badge: z.string().max(40).optional(),
    /*
     * Tri-state on purpose: null means the merchant has not said, which the
     * storefront shows as nothing. That is a different claim from "No".
     */
    isRefundable: z.boolean().nullable().optional(),
    hasWarranty: z.boolean().nullable().optional(),

    video: z.url("Video must be a valid URL").nullable().optional(),
    videoThumbnail: z.url("Video thumbnail must be a valid URL").nullable().optional(),

    /** Collection ids this product belongs to. The full intended set — omitted leaves them alone. */
    collectionIds: z.array(z.string()).optional(),
    /** Keyword names, created on demand. The full intended set. */
    tags: z.array(z.string().max(60)).optional(),

    options: z.array(productOptionZodSchema).optional(),
    variants: z.array(productVariantZodSchema).optional(),
    images: z.array(productImageZodSchema).optional(),
    attributes: z.array(productAttributeZodSchema).optional(),
    imageSlots: z.array(imageSlotZodSchema).optional(),
});

/**
 * Checks the product's own three prices and each variant's own three.
 *
 * A variant is judged against its own values, not against its product's: a
 * variant that overrides only `offerPrice` inherits nothing to compare it to,
 * and comparing across the two would reject legitimate per-variant pricing.
 */
const checkPrices = (
    payload: {
        offerPrice?: number | null;
        sellingPrice?: number | null;
        purchasePrice?: number | null;
        variants?: { offerPrice?: number | null; sellingPrice?: number | null; purchasePrice?: number | null }[];
    },
    ctx: z.RefinementCtx,
) => {
    addPriceConsistencyIssues(payload, ctx);
    payload.variants?.forEach((variant, index) => {
        addPriceConsistencyIssues(variant, ctx, ["variants", index]);
    });
};

export const createProductZodSchema = productBaseZodSchema.superRefine(checkPrices);

/*
 * Refined separately rather than as `createProductZodSchema.partial()`: once a
 * schema carries a refinement it is no longer an object schema, so `.partial()`
 * is not available on it. The base is made partial first, then the same check
 * is attached.
 *
 * On a partial payload this only catches contradictions visible within the
 * request itself. A payload that raises `offerPrice` above a `sellingPrice` it
 * does not mention still has to be caught against the stored row, which the
 * service does before writing. See design.md Decision 5.
 */
export const updateProductZodSchema = productBaseZodSchema.partial().superRefine(checkPrices);

/**
 * Query params for `GET /products/search`.
 *
 * Applied by the controller rather than the `validateRequest` middleware,
 * which only ever parses `req.body` and so cannot see a GET's query string.
 *
 * `q` is trimmed before the length check, so a whitespace-only term is
 * rejected rather than reaching the database as a search for nothing. `limit`
 * arrives as a string from the query string; it is coerced, and the service
 * still clamps it to the server cap — this schema only rejects nonsense.
 */
export const searchProductsZodSchema = z.object({
    q: z
        .string("A search term is required")
        .trim()
        .min(1, "A search term is required")
        .max(100, "Search term is too long"),
    limit: z.coerce.number().int().positive().optional(),
});

/**
 * Fields the PUBLIC product listing may be ordered by.
 *
 * The rule that keeps this list checkable: a field belongs here only if its
 * value is already part of the public product payload. If a shopper can read
 * the value, they may order by it.
 *
 * This exists because `QueryBuilder.sort()` puts `sortBy` straight into
 * Prisma's `orderBy` with no whitelist of its own, so without this an
 * anonymous caller could order the catalog by `purchasePrice` and read off every
 * product's margin ranking — a column that appears in no public response.
 *
 * Deliberately NOT applied to the admin listing: an admin is already entitled
 * to every column, and restricting it would break admin tooling for no gain.
 */
export const PUBLIC_PRODUCT_SORT_FIELDS = [
    "createdAt",
    "offerPrice",
    "name",
    "averageRating",
    "totalSold",
    "viewCount",
] as const;

/**
 * Query params for `GET /products`.
 *
 * Applied by the controller, not the `validateRequest` middleware — that
 * middleware only parses `req.body` and so cannot see a GET's query string
 * (same reason `searchProductsZodSchema` above is controller-applied).
 *
 * Unknown keys pass through: this schema exists to constrain `sortBy` and to
 * coerce `isFeatured`, not to enumerate every filter the listing accepts.
 * An out-of-list `sortBy` is a 400 rather than a silent fallback to the
 * default ordering — returning 200 in an order the caller did not ask for and
 * cannot detect is the failure this guards against.
 */
export const publicProductQueryZodSchema = z.looseObject({
    sortBy: z
        .enum(
            PUBLIC_PRODUCT_SORT_FIELDS,
            `sortBy must be one of: ${PUBLIC_PRODUCT_SORT_FIELDS.join(", ")}`,
        )
        .optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    // Arrives as the string "true"/"false" from the query string. Parsed
    // explicitly rather than by truthiness, which would read "false" as true
    // and turn `isFeatured=false` into a filter for featured products.
    isFeatured: z
        .enum(["true", "false"], "isFeatured must be true or false")
        .transform((value) => value === "true")
        .optional(),
});
