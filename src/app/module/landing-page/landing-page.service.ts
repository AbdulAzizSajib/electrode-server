import status from "http-status";
import {
    AuditAction,
    LandingPageStatus,
    Prisma,
    ProductStatus,
    SiteMode,
} from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { revalidateStorefront, STORE_SETTINGS_TAG } from "../../utils/revalidateStorefront";
import { AuditLogService } from "../audit-log/audit-log.service";
import type { ICheckoutActor } from "../order/order.interface";
import { quoteCharges, roundMoney } from "../order/order.pricing";
import { OrderService } from "../order/order.service";
import { SINGLETON_ID } from "../store-setting/store-setting.constant";
import {
    DEFAULT_DELIVERY_ZONES,
    DEFAULT_ORDER_FORM,
    LANDING_PAGES_TAG,
} from "./landing-page.constant";
import type {
    ICreateLandingPagePayload,
    IDeliveryZone,
    ILandingPageOrderForm,
    ILandingPageProductSnapshot,
    ILandingPageQuoteResult,
    IPlaceLandingPageOrderPayload,
    IUpdateLandingPagePayload,
} from "./landing-page.interface";
import {
    collectMissingLandingPageFields,
    missingLandingPageFieldsMessage,
} from "./landing-page.order-fields";

/**
 * The merchant's own order, then newest first among equals — the same
 * DISPLAY_ORDER Banner and Testimonial use, so every content list in the admin
 * behaves the same way when a merchant leaves every `sortOrder` at 0.
 */
const DISPLAY_ORDER = [{ sortOrder: "asc" as const }, { createdAt: "desc" as const }];

/**
 * Drops BOTH cached tags a landing page write can invalidate.
 *
 * The page's own content is the obvious one. The settings payload is the
 * non-obvious one, and omitting it would be a real bug: `/settings/public`
 * reports `siteMode` and the active page only while that page is PUBLISHED, so
 * publishing, unpublishing or deleting a page changes what the settings payload
 * says about the storefront ROOT — not just what `/lp/<slug>` renders. Pinging
 * only the landing-page tag would leave a storefront whose cached settings
 * still route the root at a page that is no longer live.
 *
 * Both are fire-and-forget and neither can fail the write that preceded it.
 */
const revalidateLandingPageCaches = () => {
    revalidateStorefront(LANDING_PAGES_TAG);
    revalidateStorefront(STORE_SETTINGS_TAG);
};

/**
 * Lowercase words joined by single hyphens, from whatever the merchant typed.
 *
 * Deliberately NOT `slugifyTitle` from page.constant.ts. That helper strips
 * everything outside `[a-z0-9]`, which turns a Bangla title — the common case
 * for this feature, and the whole reason it exists — into an empty string, so
 * every merchant naming their campaign "শীতের অফার" would be met with "could
 * not derive a slug". A landing page's slug is a URL an ad points at, not
 * something the shopper reads, so falling back to a generated one is right and
 * a hard error is not.
 */
const slugifyCampaignTitle = (title: string): string =>
    title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

/** Short, URL-safe, and enough to keep generated slugs apart. */
const randomSlugSuffix = (): string => Math.random().toString(36).slice(2, 8);

/**
 * Resolves the slug a write should store.
 *
 * An explicit slug wins. Otherwise it is derived from the title, then from the
 * headline, and finally generated — a landing page always gets a usable URL.
 * The derived value is re-checked against the format rule because the Zod
 * schema only validates a slug the client actually sent.
 */
const resolveSlug = (
    explicit: string | undefined,
    title: string | undefined,
    headline: string | undefined,
): string => {
    if (explicit) return explicit;

    const derived = slugifyCampaignTitle(title ?? "") || slugifyCampaignTitle(headline ?? "");

    return derived || `campaign-${randomSlugSuffix()}`;
};

/**
 * Checked before the write rather than relying on Prisma's unique constraint,
 * so the merchant gets the name of the page holding the slug instead of a raw
 * P2002. `excludeId` lets an update keep its own slug.
 */
const assertSlugAvailable = async (slug: string, excludeId?: string) => {
    const clash = await prisma.landingPage.findUnique({
        where: { slug },
        select: { id: true, title: true },
    });

    if (clash && clash.id !== excludeId) {
        throw new AppError(
            status.CONFLICT,
            `The slug "${slug}" is already used by the landing page "${clash.title}"`,
        );
    }
};

/** Generates a free slug from a base, for duplicate. */
const nextAvailableSlug = async (base: string): Promise<string> => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = attempt === 0 ? `${base}-copy` : `${base}-copy-${attempt + 1}`;
        const taken = await prisma.landingPage.findUnique({
            where: { slug: candidate },
            select: { id: true },
        });
        if (!taken) return candidate;
    }

    return `${base}-${randomSlugSuffix()}`;
};

const getLandingPageOrThrow = async (id: string) => {
    const landingPage = await prisma.landingPage.findUnique({
        where: { id },
        include: { product: { select: { id: true, name: true, slug: true } } },
    });

    if (!landingPage) {
        throw new AppError(status.NOT_FOUND, "Landing page not found");
    }

    return landingPage;
};

/** A landing page with no product cannot price, cannot quote and cannot order. */
const assertProductExists = async (productId: string) => {
    const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
    });

    if (!product) {
        throw new AppError(status.BAD_REQUEST, "Select the product this landing page sells");
    }
};

/**
 * Refuses the changes that would leave the storefront root serving nothing.
 *
 * Called before unpublishing and before deleting. Reads the settings row inside
 * the caller's transaction so a merchant switching the mode on in one tab
 * cannot race a merchant unpublishing the page in another: one of the two sees
 * the other's committed row and is refused.
 *
 * Only blocks while the shop is ACTUALLY in LANDING_PAGE mode. Deleting a page
 * that is merely selected, in WEBSITE mode, is allowed — the FK nulls the
 * pointer, and the next attempt to switch the mode on is refused for want of a
 * selection. See design.md, Decision 5.
 */
const assertNotLiveLandingPage = async (
    tx: Pick<typeof prisma, "storeSetting">,
    landingPageId: string,
    action: "unpublish" | "delete",
) => {
    const setting = await tx.storeSetting.findUnique({
        where: { id: SINGLETON_ID },
        select: { siteMode: true, activeLandingPageId: true },
    });

    if (
        setting?.siteMode === SiteMode.LANDING_PAGE &&
        setting.activeLandingPageId === landingPageId
    ) {
        throw new AppError(
            status.CONFLICT,
            `This landing page is currently live at your storefront's home page, so it cannot be ${
                action === "unpublish" ? "unpublished" : "deleted"
            }. Switch your site back to website mode, or make a different landing page the active one, and try again.`,
        );
    }
};

const createLandingPage = async (
    userId: string | undefined,
    payload: ICreateLandingPagePayload,
) => {
    await assertProductExists(payload.productId);

    const slug = resolveSlug(payload.slug, payload.title, payload.headline);
    await assertSlugAvailable(slug);

    const landingPage = await prisma.landingPage.create({
        data: {
            ...payload,
            slug,
            /*
             * Seeded here rather than defaulted in Postgres so the Bangla
             * defaults live in one readable place beside the rest of the
             * module's content, and so a merchant editing them later is editing
             * ordinary stored content rather than fighting a column default.
             */
            deliveryZones: payload.deliveryZones ?? DEFAULT_DELIVERY_ZONES,
            orderForm: payload.orderForm ?? DEFAULT_ORDER_FORM,
            // Cast for the Json columns only — Prisma types them as
            // InputJsonValue, which our shaped interfaces do not structurally
            // satisfy. Safe because the Zod schemas already validated every one
            // of them; same posture as store-setting.service.ts's upsert.
        } as unknown as Prisma.LandingPageUncheckedCreateInput,
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "LandingPage", landingPage.id, {
        newData: landingPage,
    });

    revalidateLandingPageCaches();

    return landingPage;
};

const updateLandingPage = async (
    userId: string | undefined,
    id: string,
    payload: IUpdateLandingPagePayload,
) => {
    const existing = await getLandingPageOrThrow(id);

    if (payload.productId && payload.productId !== existing.productId) {
        await assertProductExists(payload.productId);
    }

    // Only re-resolve when the client actually touched the slug. A PATCH that
    // just flips `status` must not silently re-derive the slug and move a live
    // campaign's URL out from under the ads pointing at it.
    const slug =
        payload.slug !== undefined
            ? resolveSlug(payload.slug, existing.title, existing.headline)
            : undefined;

    if (slug && slug !== existing.slug) {
        await assertSlugAvailable(slug, id);
    }

    const isUnpublishing =
        payload.status === LandingPageStatus.DRAFT &&
        existing.status === LandingPageStatus.PUBLISHED;

    const landingPage = await prisma.$transaction(async (tx) => {
        if (isUnpublishing) {
            await assertNotLiveLandingPage(tx, id, "unpublish");
        }

        return tx.landingPage.update({
            where: { id },
            data: {
                ...payload,
                ...(slug ? { slug } : {}),
            } as Prisma.LandingPageUncheckedUpdateInput,
        });
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "LandingPage", id, {
        oldData: existing,
        newData: landingPage,
    });

    revalidateLandingPageCaches();

    return landingPage;
};

const deleteLandingPage = async (userId: string | undefined, id: string) => {
    const existing = await getLandingPageOrThrow(id);

    const landingPage = await prisma.$transaction(async (tx) => {
        await assertNotLiveLandingPage(tx, id, "delete");

        return tx.landingPage.delete({ where: { id } });
    });

    await AuditLogService.record(userId, AuditAction.DELETE, "LandingPage", id, {
        oldData: existing,
    });

    revalidateLandingPageCaches();

    return landingPage;
};

/**
 * Copies a page so the next campaign can be drafted while the current one runs.
 *
 * Always DRAFT, always a new slug: a duplicate that arrived PUBLISHED would put
 * a half-edited copy of a live campaign on the internet the moment it was
 * created.
 */
const duplicateLandingPage = async (userId: string | undefined, id: string) => {
    const source = await getLandingPageOrThrow(id);

    /*
     * Listed field by field rather than spread-minus-the-keys-we-do-not-want.
     *
     * A spread would copy any column added to LandingPage later without anyone
     * deciding whether a duplicate should carry it — and the wrong answer for a
     * future counter or a per-page statistic is to silently inherit the
     * original's. Adding a column here is a two-line change; adding one that a
     * spread quietly copies is a bug nobody sees.
     */
    const landingPage = await prisma.landingPage.create({
        data: {
            title: `${source.title} (copy)`,
            slug: await nextAvailableSlug(source.slug),
            status: LandingPageStatus.DRAFT,
            productId: source.productId,

            headline: source.headline,
            subheadline: source.subheadline,
            badgeText: source.badgeText,
            bodyHtml: source.bodyHtml,

            media: source.media,
            highlights: source.highlights,
            faqs: source.faqs,
            quotes: source.quotes,
            trustBadges: source.trustBadges,
            deliveryZones: source.deliveryZones,
            orderForm: source.orderForm,

            successHeading: source.successHeading,
            successMessage: source.successMessage,

            metaTitle: source.metaTitle,
            metaDescription: source.metaDescription,
            ogImageUrl: source.ogImageUrl,
            facebookPixelId: source.facebookPixelId,

            sortOrder: source.sortOrder,
        } as unknown as Prisma.LandingPageUncheckedCreateInput,
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "LandingPage", landingPage.id, {
        newData: landingPage,
    });

    return landingPage;
};

/**
 * Admin list: any status, in display order, each row carrying what its campaign
 * produced.
 *
 * The order count and revenue are fetched in ONE grouped query over the page of
 * rows rather than per row — a list of ten campaigns must not be eleven
 * queries. Revenue counts every order the page produced regardless of status,
 * which is what "what did this campaign bring in" means at the point a merchant
 * is comparing two of them; a cancelled order still tells them the ad worked.
 */
const getAdminLandingPages = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.landingPage, {
        ...queryParams,
        sortBy: queryParams.sortBy || "sortOrder",
        sortOrder: queryParams.sortOrder || "asc",
    }, {
        searchableFields: ["title", "slug", "headline"],
        filterableFields: ["status", "productId"],
    });

    const { data, meta } = await queryBuilder
        .search()
        .filter()
        .sort()
        .paginate()
        .include({ product: { select: { id: true, name: true, slug: true } } })
        .execute();

    const rows = data as { id: string }[];

    const totals = rows.length
        ? await prisma.order.groupBy({
              by: ["landingPageId"],
              where: { landingPageId: { in: rows.map((row) => row.id) } },
              _count: { _all: true },
              _sum: { totalAmount: true },
          })
        : [];

    const totalsByPage = new Map(
        totals.map((row) => [
            row.landingPageId,
            {
                orderCount: row._count._all,
                revenue: Number(row._sum.totalAmount ?? 0),
            },
        ]),
    );

    return {
        data: rows.map((row) => ({
            ...row,
            ...(totalsByPage.get(row.id) ?? { orderCount: 0, revenue: 0 }),
        })),
        meta,
    };
};

/**
 * What the storefront needs about the bound product, resolved server-side.
 *
 * `available` is summed across every warehouse's `quantity - reservedQuantity`,
 * which is what the checkout's own stock check reads — so the page's "out of
 * stock" state and the order endpoint's rejection agree rather than disagreeing
 * against two different numbers. It is deliberately NOT `Product.stockQuantity`,
 * which is a denormalised total that reservations do not touch.
 *
 * A landing page sells the BASE product, not a variant: the page has no variant
 * picker, so availability sums every variant's rows and the order is placed
 * without a variant id. A merchant who needs a variant sold on its own campaign
 * page has a product-level decision to make, not a page-level one.
 */
const buildProductSnapshot = async (productId: string): Promise<ILandingPageProductSnapshot> => {
    const [product, stock] = await Promise.all([
        prisma.product.findUnique({
            where: { id: productId },
            select: {
                id: true,
                name: true,
                slug: true,
                price: true,
                compareAtPrice: true,
                unit: true,
                status: true,
                images: {
                    select: { url: true, altText: true },
                    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
                },
            },
        }),
        prisma.stock.aggregate({
            where: { productId },
            _sum: { quantity: true, reservedQuantity: true },
        }),
    ]);

    if (!product) {
        throw new AppError(status.NOT_FOUND, "This landing page's product is no longer available");
    }

    const available =
        (stock._sum.quantity ?? 0) - (stock._sum.reservedQuantity ?? 0);

    return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        unitPrice: Number(product.price),
        compareAtPrice: product.compareAtPrice === null ? null : Number(product.compareAtPrice),
        unit: product.unit,
        images: product.images.map((image) => ({ url: image.url, alt: image.altText })),
        available: Math.max(0, available),
        isOrderable: product.status === ProductStatus.ACTIVE && available > 0,
    };
};

/**
 * Public read: PUBLISHED only.
 *
 * A DRAFT is indistinguishable from a page that does not exist — the caller
 * gets null either way and the storefront 404s, so an unpublished campaign's
 * headline is never disclosed by the shape of the response and slugs cannot be
 * probed for pages that are not live yet.
 */
const getPublishedBySlug = async (slug: string) => {
    const landingPage = await prisma.landingPage.findFirst({
        where: { slug, status: LandingPageStatus.PUBLISHED },
    });

    if (!landingPage) return null;

    return { ...landingPage, productSnapshot: await buildProductSnapshot(landingPage.productId) };
};

/**
 * Authenticated preview: any status, by slug.
 *
 * The same payload the public read returns, so what a merchant previews is what
 * a shopper would see. Reachable only behind owner/admin auth — the route is
 * what enforces that, and it is the reason this is a separate function rather
 * than a `?preview=true` flag on the public one, which would be one forgotten
 * check away from publishing every draft.
 */
const getAnyBySlugForPreview = async (slug: string) => {
    const landingPage = await prisma.landingPage.findUnique({ where: { slug } });

    if (!landingPage) {
        throw new AppError(status.NOT_FOUND, "Landing page not found");
    }

    return { ...landingPage, productSnapshot: await buildProductSnapshot(landingPage.productId) };
};

/** The published pages the admin's active-page selector may offer. */
const getPublishedSummaries = async () => {
    return prisma.landingPage.findMany({
        where: { status: LandingPageStatus.PUBLISHED },
        select: { id: true, title: true, slug: true },
        orderBy: DISPLAY_ORDER,
    });
};

/**
 * The zone a submission named, or a refusal.
 *
 * Looked up by key against the STORED zones — the price that arrives from a
 * browser is not an input to what anything costs. An unknown key is a rejection
 * rather than a fallback to the first zone: silently charging the cheapest
 * delivery for an unrecognised choice is how a page ends up shipping across the
 * country for the inside-Dhaka rate.
 */
const resolveDeliveryZone = (zones: IDeliveryZone[], zoneKey: string): IDeliveryZone => {
    const zone = zones.find((candidate) => candidate.key === zoneKey);

    if (!zone) {
        throw new AppError(status.BAD_REQUEST, "Select a delivery area");
    }

    return zone;
};

/**
 * The published page a public request names, or a 404.
 *
 * Shared by the quote and the order endpoints so neither can be reached for a
 * DRAFT page: a campaign that is not live must not be orderable, and a slug
 * that is not live must not be distinguishable from one that does not exist.
 */
const getOrderablePageOrThrow = async (slug: string) => {
    const landingPage = await prisma.landingPage.findFirst({
        where: { slug, status: LandingPageStatus.PUBLISHED },
    });

    if (!landingPage) {
        throw new AppError(status.NOT_FOUND, "Landing page not found");
    }

    return landingPage;
};

/**
 * What the page displays as the shopper changes quantity or delivery area.
 *
 * Computed by the SAME `quoteCharges` the order will be priced by, from the
 * product's stored price and the zone's stored price. That identity is the
 * point: the totals a shopper sees before submitting and the totals they are
 * charged come from one implementation, so the page cannot quote one number and
 * the order charge another. Reimplementing the tax rules in the browser would
 * be a second answer to "what does this cost", which order.pricing.ts exists to
 * prevent.
 */
const quoteLandingPageOrder = async (
    slug: string,
    input: { quantity: number; zoneKey: string },
): Promise<ILandingPageQuoteResult> => {
    const landingPage = await getOrderablePageOrThrow(slug);

    const zone = resolveDeliveryZone(
        landingPage.deliveryZones as unknown as IDeliveryZone[],
        input.zoneKey,
    );

    const product = await prisma.product.findUnique({
        where: { id: landingPage.productId },
        select: { id: true, name: true, price: true, taxRuleId: true, shippingRuleId: true },
    });

    if (!product) {
        throw new AppError(status.NOT_FOUND, "This landing page's product is no longer available");
    }

    const lineTotal = roundMoney(Number(product.price) * input.quantity);

    const charges = await quoteCharges({
        lines: [
            {
                productId: product.id,
                productName: product.name,
                quantity: input.quantity,
                lineTotal,
                taxRuleId: product.taxRuleId,
            },
        ],
        // A landing page has no coupon box, so there is nothing to discount.
        discountAmount: 0,
        // No option key: the override below prices this order from the page's
        // own zones, so `quoteDelivery` is never consulted. That is what lets a
        // page sell whether or not the shop has configured delivery at all.
        couponWaivesShipping: false,
        // Explicitly null rather than read from the shop: the page printed a
        // delivery charge beside the order button, and an unrelated shop-wide
        // threshold must not silently zero it. See order.pricing.ts.
        freeShippingThreshold: null,
        shippingOverride: { amount: zone.price, label: zone.label },
    });

    return {
        quantity: input.quantity,
        zoneKey: zone.key,
        zoneLabel: zone.label,
        subtotal: charges.subtotal,
        taxAmount: charges.taxAmount,
        shippingAmount: charges.shippingAmount,
        totalAmount: roundMoney(charges.subtotal + charges.shippingAmount + charges.taxAmount),
    };
};

/**
 * Places a campaign order.
 *
 * Everything that makes an order an order — the order number, the stock
 * deduction, the PENDING cash-on-delivery payment, the status history, the
 * guest COD abuse caps, idempotency and the merchant notification — happens in
 * `OrderService.placeOrder`, the same core the normal checkout runs through.
 * This function's whole job is to turn a three-field campaign form into that
 * core's payload and to say the three ways this path differs (ICheckoutOverrides).
 *
 * The address mapping is worth stating: the page's single address box becomes
 * `addressLine1`, and the chosen zone's LABEL becomes `state`, because that is
 * the delivery region the shopper declared and it is what the admin's order
 * detail and the courier both read. `city` and `postalCode` are left unset —
 * the page did not ask, and recording a guess would be worse than recording
 * nothing. `country` falls to CustomerAddress's own "Bangladesh" default.
 */
const placeLandingPageOrder = async (
    actor: ICheckoutActor,
    slug: string,
    payload: IPlaceLandingPageOrderPayload & { idempotencyKey?: string },
) => {
    const landingPage = await getOrderablePageOrThrow(slug);

    const orderForm = landingPage.orderForm as unknown as ILandingPageOrderForm;
    const zone = resolveDeliveryZone(
        landingPage.deliveryZones as unknown as IDeliveryZone[],
        payload.zoneKey,
    );

    /*
     * The page's own required-field rule, and the whole of it. See
     * landing-page.order-fields.ts on why this is not the shop's
     * `collectMissingCheckoutFields`.
     */
    const missing = collectMissingLandingPageFields(orderForm, {
        fullName: payload.fullName,
        phone: payload.phone,
        address: payload.address,
    });

    if (missing.length > 0) {
        throw new AppError(status.BAD_REQUEST, missingLandingPageFieldsMessage(missing));
    }

    return OrderService.placeOrder(
        actor,
        {
            fullName: payload.fullName,
            phone: payload.phone,
            shippingAddress: {
                addressLine1: payload.address.trim(),
                city: "",
                state: zone.label,
            },
            // The cart bypass: these lines are ordered directly and the
            // shopper's own cart is left exactly as they left it.
            items: [{ productId: landingPage.productId, quantity: payload.quantity }],
            paymentMethod: "COD",
            notes: payload.notes,
            expectedTotal: payload.expectedTotal,
            idempotencyKey: payload.idempotencyKey,
        },
        {
            shippingOverride: { amount: zone.price, label: zone.label },
            bypassCheckoutConfig: true,
            landingPage: { id: landingPage.id, title: landingPage.title },
        },
    );
};

export const LandingPageService = {
    createLandingPage,
    updateLandingPage,
    deleteLandingPage,
    duplicateLandingPage,
    getAdminLandingPages,
    getLandingPageOrThrow,
    getPublishedBySlug,
    getAnyBySlugForPreview,
    getPublishedSummaries,
    buildProductSnapshot,
    resolveDeliveryZone,
    quoteLandingPageOrder,
    placeLandingPageOrder,
};
