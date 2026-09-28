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
import { CampaignService } from "../campaign/campaign.service";
import type { ICheckoutActor } from "../order/order.interface";
import { quoteCharges, roundMoney, splitAdvance } from "../order/order.pricing";
import { OrderService } from "../order/order.service";
import { SINGLETON_ID } from "../store-setting/store-setting.constant";
import { StoreSettingService } from "../store-setting/store-setting.service";
import {
    DEFAULT_ORDER_FORM,
    LANDING_PAGES_TAG,
} from "./landing-page.constant";
import type { IAdvancePaymentConfig, ICheckoutConfig } from "../store-setting/store-setting.interface";
import type {
    ICreateLandingPagePayload,
    ILandingPageOrderForm,
    ILandingPagePackage,
    ILandingPageProductSnapshot,
    ILandingPageQuoteResult,
    IPlaceLandingPageOrderPayload,
    IResolvedLandingPackage,
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
 * says about the storefront ROOT — not just what `/offer/<slug>` renders. Pinging
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

    /*
     * PER-PACKAGE TOTALS, on the detail read only.
     *
     * A merchant running a two-tier offer can see the campaign's total on the
     * list; what decides what they advertise next is WHICH tier the money came
     * from. Grouped by the key captured on the order, so a package since
     * deleted still reports what it earned — which is exactly when this figure
     * is most wanted.
     *
     * Not on the LIST: it would be a second grouped query per page of rows for
     * a number nobody reads until they open one campaign.
     */
    const byPackage = await prisma.order.groupBy({
        by: ["landingPackageKey", "landingPackageLabel"],
        where: { landingPageId: id, landingPackageKey: { not: null } },
        _count: { _all: true },
        _sum: { totalAmount: true },
    });

    return {
        ...landingPage,
        packageTotals: byPackage.map((row) => ({
            key: row.landingPackageKey,
            label: row.landingPackageLabel,
            orderCount: row._count._all,
            revenue: Number(row._sum.totalAmount ?? 0),
        })),
    };
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

/**
 * Refuses the switch when the shop cannot back it.
 *
 * Checked on SAVE rather than only at render, so the merchant is told at the
 * moment they can act on it. Naming where the accounts live is the point of
 * the message: the switch is on the campaign and the thing it depends on is
 * two screens away, which is exactly the kind of dependency a merchant
 * discovers as "the toggle does nothing".
 */
const assertAdvancePaymentAvailable = async (requiresAdvance: boolean | undefined) => {
    if (!requiresAdvance) return;

    const checkoutConfig = await StoreSettingService.getCheckoutConfig();
    const shop = checkoutConfig.advancePayment;

    if (!shop.enabled) {
        throw new AppError(
            status.BAD_REQUEST,
            "Turn advance payment on in Settings → Checkout Setting before asking for it on a campaign.",
        );
    }

    if (shop.mobileAccounts.length === 0 && shop.bankAccounts.length === 0) {
        throw new AppError(
            status.BAD_REQUEST,
            "Add a mobile banking or bank account in Settings → Checkout Setting — a campaign cannot ask for money with nowhere to send it.",
        );
    }
};

const createLandingPage = async (
    userId: string | undefined,
    payload: ICreateLandingPagePayload,
) => {
    await assertProductExists(payload.productId);
    await assertAdvancePaymentAvailable(payload.requiresAdvancePayment);

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

    // Only when the client is turning it ON. A PATCH that leaves the field
    // alone must not fail because the shop's accounts changed since — the page
    // already degrades to cash on delivery in that case.
    await assertAdvancePaymentAvailable(payload.requiresAdvancePayment);

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
/**
 * THE SINGLE ANSWER to "what does this page sell right now".
 *
 * Every pricing path goes through here — the rendered page, the quote, and the
 * order that is actually charged. That is not tidiness: it is the entire reason
 * a package may author its own price at all. The model's rule is that a landing
 * page must never quote one number and charge another, and this function is how
 * the rule survives packages. A second place that decides a package's price
 * would reintroduce the bug the rule was written against.
 *
 * THAT BUG HAS ALREADY HAPPENED ONCE on this exact code path. The quote used to
 * charge bare `offerPrice` while the page and the order applied the running
 * campaign, so for as long as a campaign ran, the form submitted an
 * `expectedTotal` that placement refused with a 409 — every order from the page
 * failed, silently, for the duration of the campaign it was advertising. See
 * the comment in `quoteLandingPageOrder`.
 *
 * Resolution rules:
 *   - no packages at all        → the bound product at its own price
 *   - packages, no key given    → the preselected one, else the first
 *   - packages, key given       → that package, or a 400 naming it
 *
 * A page whose packages were all deleted falls back to the bound product rather
 * than breaking, which is what makes removing them a safe rollback.
 */
/**
 * What advance payment this campaign actually offers, or null.
 *
 * TWO SWITCHES AND A LIST, resolved to one answer. A campaign asks for an
 * advance only when its own switch is on, the SHOP has advance payment
 * enabled, and the shop has at least one account to send money to. Any of the
 * three missing means "not offered".
 *
 * THE CAMPAIGN'S SWITCH IS AN AND, NEVER AN OVERRIDE, and the direction
 * matters: a merchant who clears their accounts must not leave six live
 * campaigns asking for money with nowhere to send it. Every campaign degrades
 * to cash on delivery instead, which is the only safe way for this to fail.
 *
 * ONE ANSWER, read by the page render, the quote and the placement — the same
 * shape `resolveLandingPackage` below takes, for the same reason. Three callers
 * deciding independently is three chances to disagree, and the disagreement
 * here is a page that shows a payment form the order endpoint then refuses.
 *
 * The accounts are the SHOP'S. There is deliberately no per-campaign account
 * list; see LandingPage.prisma on `requiresAdvancePayment`.
 *
 * See openspec/changes/add-landing-page-advance-payment, design.md Decision 2.
 */
const resolveLandingAdvancePayment = (
    page: { requiresAdvancePayment: boolean },
    checkoutConfig: ICheckoutConfig,
): IAdvancePaymentConfig | null => {
    if (!page.requiresAdvancePayment) return null;

    const shop = checkoutConfig.advancePayment;
    if (!shop.enabled) return null;

    const hasAccount = shop.mobileAccounts.length > 0 || shop.bankAccounts.length > 0;
    if (!hasAccount) return null;

    return shop;
};

const resolveLandingPackage = (
    page: { productId: string; packages: Prisma.JsonValue | null },
    packageKey?: string | null,
): IResolvedLandingPackage => {
    const packages = (page.packages ?? []) as unknown as ILandingPagePackage[];

    const boundProduct: IResolvedLandingPackage = {
        productId: page.productId,
        // Null, not a number: "read the product's own offerPrice". A page with
        // no packages must price exactly as it did before packages existed.
        authoredPrice: null,
        packageKey: null,
        packageLabel: null,
        freeGiftText: null,
        compareAtPrice: null,
    };

    if (!Array.isArray(packages) || packages.length === 0) {
        return boundProduct;
    }

    const chosen = packageKey
        ? packages.find((pkg) => pkg.key === packageKey)
        : (packages.find((pkg) => pkg.preselected) ?? packages[0]);

    /*
     * A key the page does not offer is REFUSED, never quietly defaulted. A
     * client naming a stale key — the merchant deleted that tier while the page
     * was open — must be told, not silently charged for a different package
     * than the one whose price it read.
     */
    if (!chosen) {
        throw new AppError(
            status.BAD_REQUEST,
            "That package is no longer offered — please reload the page and choose again.",
        );
    }

    return {
        productId: chosen.productId,
        authoredPrice: chosen.price,
        packageKey: chosen.key,
        packageLabel: chosen.label,
        freeGiftText: chosen.freeGiftText ?? null,
        compareAtPrice: chosen.compareAtPrice ?? null,
    };
};

const buildProductSnapshot = async (
    productId: string,
    /**
     * The resolved package, when one is selected.
     *
     * Its authored price REPLACES the product's `offerPrice` as the basis, and
     * the campaign resolver still runs on top — so a campaign discounting the
     * package's product reaches the page that sells it, exactly as it does for
     * a page with no packages.
     */
    resolved?: IResolvedLandingPackage,
): Promise<ILandingPageProductSnapshot> => {
    const [product, stock] = await Promise.all([
        prisma.product.findUnique({
            where: { id: productId },
            select: {
                id: true,
                name: true,
                slug: true,
                offerPrice: true,
                sellingPrice: true,
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

    /*
     * A landing page sells the base product, so it is priced by the same
     * resolver the order path uses — a campaign discounting this product must
     * reach the page that sells it, or the ad quotes one price and the order
     * charges another. `variantId: null` because the page has no picker.
     */
    /*
     * The BASIS price: a selected package's authored price, or the product's
     * own offer price when the page has no packages. The campaign resolver runs
     * on top of whichever it is, so a running campaign reaches a packaged page
     * exactly as it reaches an unpackaged one.
     */
    const offerPrice = resolved?.authoredPrice ?? Number(product.offerPrice);
    const campaignPriceByKey = await CampaignService.getActiveDiscountsForLines([
        { productId: product.id, variantId: null, unitPrice: offerPrice },
    ]);
    const unitPrice = campaignPriceByKey.get(`${product.id}:`) ?? offerPrice;

    return {
        id: product.id,
        // The PACKAGE's name when one is selected — "১ কেজি দানাদার ঘি" is what
        // the shopper chose and what the order says, not the bare product name.
        name: resolved?.packageLabel ?? product.name,
        slug: product.slug,
        // `unitPrice` keeps its name — it is this snapshot's own field, and what
        // a landing page charges per unit is the product's offer price, less any
        // campaign discount currently running against it.
        unitPrice,
        /*
         * The struck-through comparison. Under a campaign the offer price is
         * itself a saving, so it stands in when the merchant set no separate
         * selling price — otherwise a discounted page would show a cut price
         * with nothing to compare it against.
         */
        sellingPrice:
            /*
             * A PACKAGE'S OWN compareAtPrice WINS when it has one. ৳২১০০ struck
             * through beside ৳১৫৯৯ is the package's claim, and falling back to
             * the product's `sellingPrice` here would strike through a figure
             * belonging to a different quantity — a ৫০০ গ্রাম price shown
             * against a ১ কেজি package, which reads as a much bigger discount
             * than the merchant offered.
             */
            resolved?.compareAtPrice ??
            (product.sellingPrice === null
                ? unitPrice < offerPrice
                    ? offerPrice
                    : null
                : Number(product.sellingPrice)),
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

    /*
     * Snapshotted for the DEFAULT package — the preselected one, or the first,
     * or the bound product when the page has none. The storefront re-quotes
     * when the shopper picks a different one; this is what the page paints with
     * before they touch anything.
     */
    const resolved = resolveLandingPackage(landingPage);

    /*
     * `offerEndsAt` travels as the ABSOLUTE INSTANT it is stored as, and no
     * remainder is computed here. The page is cached, so a server-rendered
     * "6 days left" would be wrong the moment it was stored and wronger every
     * minute after. The browser counts down from the instant instead.
     */
    const [productSnapshot, scarcity, checkoutConfig] = await Promise.all([
        buildProductSnapshot(resolved.productId, resolved),
        buildScarcity(landingPage),
        StoreSettingService.getCheckoutConfig(),
    ]);

    /*
     * The RESOLVED advance config, or null. Served on the page read so the
     * order form knows the accounts without a second request — and resolved
     * server-side so the form cannot show a payment section the order endpoint
     * would then refuse.
     */
    const advancePayment = resolveLandingAdvancePayment(landingPage, checkoutConfig);

    /*
     * THE SHOP'S DELIVERY OPTIONS, served with the page.
     *
     * A campaign no longer authors delivery prices, so the form needs the
     * shop's list to resolve the shopper's district against — and to fall back
     * to when a district resolves to nothing configured. Served here rather
     * than fetched separately because the page already reads the settings row
     * for the advance-payment config beside it.
     *
     * PICKUP OPTIONS ARE EXCLUDED. Collection in person is somewhere the
     * shopper goes, not somewhere an address resolves to, and a campaign page
     * sells one product for delivery — the same rule `resolveDeliveryOption`
     * applies on the storefront.
     */
    const deliveryOptions = checkoutConfig.delivery.options.filter(
        (option) => option.kind === "DELIVERY",
    );

    return {
        ...landingPage,
        productSnapshot,
        scarcity,
        advancePayment,
        deliveryOptions,
    };
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

    /*
     * Snapshotted for the DEFAULT package — the preselected one, or the first,
     * or the bound product when the page has none. The storefront re-quotes
     * when the shopper picks a different one; this is what the page paints with
     * before they touch anything.
     */
    const resolved = resolveLandingPackage(landingPage);

    /*
     * `offerEndsAt` travels as the ABSOLUTE INSTANT it is stored as, and no
     * remainder is computed here. The page is cached, so a server-rendered
     * "6 days left" would be wrong the moment it was stored and wronger every
     * minute after. The browser counts down from the instant instead.
     */
    const [productSnapshot, scarcity, checkoutConfig] = await Promise.all([
        buildProductSnapshot(resolved.productId, resolved),
        buildScarcity(landingPage),
        StoreSettingService.getCheckoutConfig(),
    ]);

    /*
     * The RESOLVED advance config, or null. Served on the page read so the
     * order form knows the accounts without a second request — and resolved
     * server-side so the form cannot show a payment section the order endpoint
     * would then refuse.
     */
    const advancePayment = resolveLandingAdvancePayment(landingPage, checkoutConfig);

    /*
     * THE SHOP'S DELIVERY OPTIONS, served with the page.
     *
     * A campaign no longer authors delivery prices, so the form needs the
     * shop's list to resolve the shopper's district against — and to fall back
     * to when a district resolves to nothing configured. Served here rather
     * than fetched separately because the page already reads the settings row
     * for the advance-payment config beside it.
     *
     * PICKUP OPTIONS ARE EXCLUDED. Collection in person is somewhere the
     * shopper goes, not somewhere an address resolves to, and a campaign page
     * sells one product for delivery — the same rule `resolveDeliveryOption`
     * applies on the storefront.
     */
    const deliveryOptions = checkoutConfig.delivery.options.filter(
        (option) => option.kind === "DELIVERY",
    );

    return {
        ...landingPage,
        productSnapshot,
        scarcity,
        advancePayment,
        deliveryOptions,
    };
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

    /*
     * THE DEADLINE, enforced against the SERVER's clock.
     *
     * Only when the merchant asked for it: `offerEndsAt` alone shows a
     * countdown, and `stopOrdersAtDeadline` is what actually closes the offer.
     * The two are separate because most campaigns want urgency without a hard
     * stop, and conflating them would close every offer that ever showed a
     * timer.
     *
     * Checked HERE, in the guard both the quote and the placement share, rather
     * than in each — so an expired page cannot be quoted either. A client whose
     * countdown has run out but who submits anyway is refused by the server;
     * the countdown in the browser is a courtesy, this is the control.
     */
    if (
        landingPage.stopOrdersAtDeadline &&
        landingPage.offerEndsAt &&
        landingPage.offerEndsAt.getTime() <= Date.now()
    ) {
        throw new AppError(
            status.CONFLICT,
            "This offer has ended, so orders can no longer be placed from this page.",
        );
    }

    return landingPage;
};

/**
 * How many orders this page has actually produced.
 *
 * COUNTED on every read, never stored. There is deliberately no column to hold
 * this and no field to seed it with: a stored counter is a number someone can
 * set, and a number that can be set will eventually be set to something
 * flattering — at which point the page is lying to shoppers in a way nothing
 * can detect. See design.md Decision 3.
 *
 * Counts EVERY order, including ones later cancelled. That is a known and
 * accepted imprecision: filtering by status would make a public figure move
 * BACKWARDS when a merchant cancels an order, which a shopper watching the page
 * would see. Overcounting slightly beats a number that visibly decreases.
 *
 * Served by `@@index([landingPageId])` on Order.
 */
const countLandingPageOrders = (landingPageId: string): Promise<number> =>
    prisma.order.count({ where: { landingPageId } });

/**
 * The scarcity line's figures, or null when the merchant declared no run.
 *
 * Clamped at the target so `remaining` never goes negative — past the target
 * the offer is simply reported as met, rather than as "-3 remaining", which is
 * both meaningless and an obvious tell that the number is computed rather than
 * real.
 */
const buildScarcity = async (page: { id: string; scarcityTarget: number | null }) => {
    if (!page.scarcityTarget) return null;

    const taken = await countLandingPageOrders(page.id);

    return {
        target: page.scarcityTarget,
        taken,
        remaining: Math.max(0, page.scarcityTarget - taken),
        /** Past the target the limited offer is over — the page stops presenting it. */
        met: taken >= page.scarcityTarget,
    };
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
    input: { quantity: number; deliveryOptionKey: string; packageKey?: string | null },
): Promise<ILandingPageQuoteResult> => {
    const landingPage = await getOrderablePageOrThrow(slug);


    /*
     * THROUGH THE RESOLVER, never straight off `landingPage.productId`. A quote
     * that resolved the package differently from the order would reproduce the
     * failure documented below with a package instead of a campaign.
     */
    const resolved = resolveLandingPackage(landingPage, input.packageKey);

    const product = await prisma.product.findUnique({
        where: { id: resolved.productId },
        select: { id: true, name: true, offerPrice: true, taxRuleId: true },
    });

    if (!product) {
        throw new AppError(status.NOT_FOUND, "This landing page's product is no longer available");
    }

    /*
     * The settings row, read once — the delivery options price the order and
     * the threshold decides whether that price is waived. Both now apply to a
     * campaign exactly as they apply to the catalogue.
     */
    const storeSetting = await StoreSettingService.getStoreSetting();
    const checkoutConfig = StoreSettingService.checkoutConfigOf(storeSetting.checkoutConfig);

    /*
     * Priced exactly as `OrderService.placeOrder` prices the line: the basis
     * price less any running campaign, rounded per unit and then per line.
     *
     * This quote used to charge bare `offerPrice`. The page itself
     * (`buildProductSnapshot`) and the order both apply the campaign, so while a
     * campaign ran the quote alone was higher — and the form submits this
     * quote's total as `expectedTotal`, which placement compares against its own
     * figure and refuses with a 409 "Price mismatch". Every order from the page
     * failed for exactly as long as the campaign it was advertising.
     *
     * The basis is now the resolved package's authored price when there is one,
     * which is why all three paths read `resolveLandingPackage`: the same bug,
     * one package-shaped instead of campaign-shaped, is one divergent lookup
     * away.
     */
    const offerPrice = resolved.authoredPrice ?? Number(product.offerPrice);
    const campaignPriceByKey = await CampaignService.getActiveDiscountsForLines([
        { productId: product.id, variantId: null, unitPrice: offerPrice },
    ]);
    const unitPrice = roundMoney(campaignPriceByKey.get(`${product.id}:`) ?? offerPrice);
    const lineTotal = roundMoney(unitPrice * input.quantity);

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
        /*
         * THE SHOP'S OWN DELIVERY OPTIONS, priced through `quoteDelivery` like
         * any other order. This used to pass `shippingOverride` instead, so a
         * campaign charged its own authored zone price and bypassed the shop's
         * options entirely — which meant the same customer at the same address
         * paid one figure through the catalogue and another through an ad.
         *
         * The consequence, stated because it is a real behaviour change: a
         * campaign order now RECEIVES the shop's free-shipping threshold and a
         * coupon's shipping waiver, where before it never did. One delivery
         * policy, applied everywhere.
         *
         * See openspec/changes/add-landing-page-destination-picker, design.md
         * Decision 5.
         */
        deliveryOptionKey: input.deliveryOptionKey,
        checkoutConfig,
        couponWaivesShipping: false,
        freeShippingThreshold:
            storeSetting.freeShippingThreshold === null
                ? null
                : Number(storeSetting.freeShippingThreshold),
    });

    const totalAmount = roundMoney(
        charges.subtotal + charges.shippingAmount + charges.taxAmount,
    );

    return {
        quantity: input.quantity,
        deliveryOptionKey: charges.delivery?.optionKey ?? input.deliveryOptionKey,
        deliveryOptionLabel: charges.delivery?.optionLabel ?? "",
        subtotal: charges.subtotal,
        taxAmount: charges.taxAmount,
        shippingAmount: charges.shippingAmount,
        totalAmount,
        /*
         * THE SAME `splitAdvance` THE SHOP'S QUOTE USES, imported rather than
         * reimplemented — and that is not a style preference.
         *
         * This exact path has already had a quote/placement divergence once:
         * the quote priced bare `offerPrice` while the page and the order
         * applied the running campaign, and every order from the page failed
         * with a 409 for as long as that campaign ran. An advance figure
         * computed twice is the same bug in a new place — except this time the
         * shopper has already sent the money by the time it fires.
         *
         * Both choices are always quoted, even when the campaign does not ask
         * for an advance: it derives from a total the response already carries,
         * and omitting it would force a re-fetch the moment a merchant flipped
         * the switch.
         */
        advanceOptions: {
            DELIVERY_CHARGE: splitAdvance(
                "DELIVERY_CHARGE",
                totalAmount,
                charges.shippingAmount,
            ),
            FULL: splitAdvance("FULL", totalAmount, charges.shippingAmount),
        },
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

    /*
     * The SAME resolver the quote read, which is what makes the two agree. An
     * unknown key is refused here rather than silently defaulting to another
     * package — a shopper must never be charged for a tier whose price they did
     * not read.
     */
    const resolved = resolveLandingPackage(landingPage, payload.packageKey);

    /*
     * WHETHER THIS CAMPAIGN MAY CARRY A CLAIM, through the same resolver the
     * page render and the quote read — never off `requiresAdvancePayment`
     * directly. Reading the switch here would let a campaign whose shop has
     * since removed its accounts accept a claim naming an account that no
     * longer exists.
     */
    const checkoutConfig = await StoreSettingService.getCheckoutConfig();
    const advanceOffered = resolveLandingAdvancePayment(landingPage, checkoutConfig) !== null;
    const wantsAdvance = Boolean(payload.paymentMethod && payload.paymentMethod !== "COD");

    if (wantsAdvance && !advanceOffered) {
        throw new AppError(
            status.BAD_REQUEST,
            "This campaign takes cash on delivery only — please place the order again without an advance payment.",
        );
    }

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
                /*
                 * THE DESTINATION, in the shape a shop order writes it: the
                 * district in `state`, the area in `city`. Same columns, same
                 * meaning, so staff read one thing and a courier brief does not
                 * branch on which page produced the order.
                 *
                 * This used to hold the campaign's own zone LABEL. Orders
                 * already placed keep theirs — an order records what was agreed
                 * at the time, and a zone label is a true record of what that
                 * shopper actually chose.
                 */
                city: payload.destination?.area ?? "",
                state: payload.destination?.district ?? "",
            },
            // The cart bypass: these lines are ordered directly and the
            // shopper's own cart is left exactly as they left it.
            items: [{ productId: resolved.productId, quantity: payload.quantity }],
            /*
             * NO LONGER HARDCODED. The claim is forwarded to
             * `OrderService.placeOrder`, which already validates the account,
             * refuses a reused transaction reference, computes the amount
             * server-side and writes the PROCESSING payment row — none of that
             * is reimplemented here.
             *
             * Absent, it defaults to COD exactly as before, so a campaign that
             * does not ask for an advance runs the path it always ran.
             */
            deliveryOptionKey: payload.deliveryOptionKey,
            paymentMethod: payload.paymentMethod ?? "COD",
            ...(wantsAdvance && payload.advancePayment
                ? { advancePayment: payload.advancePayment }
                : {}),
            notes: payload.notes,
            expectedTotal: payload.expectedTotal,
            idempotencyKey: payload.idempotencyKey,
        },
        {
            /*
             * NO `shippingOverride`. A campaign order is priced by the shop's
             * own delivery options now, through the key the storefront resolved
             * from the shopper's district — so the campaign and the catalogue
             * charge the same address the same amount, and the shop's
             * free-shipping threshold reaches both.
             */
            /*
             * The package's authored price becomes the line's basis. Omitted
             * for a page with no packages, which then prices from the product's
             * own offerPrice exactly as before. See `unitPriceOverride` on
             * ICheckoutOverrides for why this cannot come from a request body.
             */
            ...(resolved.authoredPrice !== null
                ? { unitPriceOverride: resolved.authoredPrice }
                : {}),
            bypassCheckoutConfig: true,
            landingPage: {
                id: landingPage.id,
                title: landingPage.title,
                ...(resolved.packageKey && resolved.packageLabel
                    ? {
                          package: {
                              key: resolved.packageKey,
                              label: resolved.packageLabel,
                              price: resolved.authoredPrice ?? 0,
                          },
                      }
                    : {}),
            },
        },
    );
};

export const LandingPageService = {
    /**
     * Exposed so the verify script can exercise the resolver directly, and so a
     * future caller reads the same answer rather than re-deriving one. There
     * must never be a second place that decides what a package costs.
     */
    resolveLandingPackage,
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
    quoteLandingPageOrder,
    placeLandingPageOrder,
};
