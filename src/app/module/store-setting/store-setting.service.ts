import status from "http-status";
import {
    AuditAction,
    LandingPageStatus,
    Prisma,
    SiteMode,
} from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { AuditLogService } from "../audit-log/audit-log.service";
import { revalidateStorefront, STORE_SETTINGS_TAG } from "../../utils/revalidateStorefront";
import {
    DEFAULT_CHECKOUT_CONFIG,
    DEFAULT_PUBLIC_SETTINGS,
    SINGLETON_ID,
} from "./store-setting.constant";
import {
    ICheckoutConfig,
    ICurrencyFormat,
    IUpdateStoreSettingPayload,
} from "./store-setting.interface";
import {
    IResolvedSiteMode,
    resolveSiteMode,
    siteModeRejection,
} from "./store-setting.site-mode";
import { checkoutConfigSchema } from "./store-setting.validation";
import { currencyFormatOf, DEFAULT_CURRENCY_FORMAT } from "../../utils/formatMoney";

/** Upserts on the fixed singleton id — there is no way, through this service, to end up with a second row. */
const getStoreSetting = async () => {
    return prisma.storeSetting.upsert({
        where: { id: SINGLETON_ID },
        update: {},
        create: { id: SINGLETON_ID },
    });
};

/**
 * The storefront-safe projection, served unauthenticated.
 *
 * Two deliberate properties:
 *
 *  1. `findUnique`, NOT the upsert `getStoreSetting` uses. That one is a read
 *     that writes; exposing it on a public route would let anonymous traffic
 *     trigger database writes. This path never mutates.
 *
 *  2. An explicit ALLOW-list, not a deny-list. A column added to StoreSetting
 *     later must be opted in here to become public — a deny-list would leak it
 *     by default the day someone adds an API key or an internal flag.
 *     `freeShippingThreshold` and the COD abuse limits stay admin-only.
 */
const getPublicStoreSetting = async () => {
    const stored = await prisma.storeSetting.findUnique({
        where: { id: SINGLETON_ID },
        /*
         * The active landing page's slug travels with the settings the
         * storefront already fetches in its root layout on every page, so
         * routing the root costs no second request and needs no second cache.
         *
         * Only the two fields the storefront routes on — never the page's
         * content, which the landing page route fetches for itself. This stays
         * an allow-list.
         */
        include: { activeLandingPage: { select: { slug: true, title: true, status: true } } },
    });

    // Merged over the in-code defaults so a cleared column — or a fresh install
    // before the seed script runs — still yields a renderable header/footer
    // rather than nulls the storefront would have to defend against.
    const merge = <T>(value: T | null | undefined, fallback: T): T =>
        value === null || value === undefined ? fallback : value;

    return {
        storeName: merge(stored?.storeName, DEFAULT_PUBLIC_SETTINGS.storeName),
        siteNameAccent: merge(stored?.siteNameAccent, DEFAULT_PUBLIC_SETTINGS.siteNameAccent),
        logoUrl: merge(stored?.logoUrl, DEFAULT_PUBLIC_SETTINGS.logoUrl),
        footerLogoUrl: merge(stored?.footerLogoUrl, DEFAULT_PUBLIC_SETTINGS.footerLogoUrl),
        aboutText: merge(stored?.aboutText, DEFAULT_PUBLIC_SETTINGS.aboutText),
        copyrightText: merge(stored?.copyrightText, DEFAULT_PUBLIC_SETTINGS.copyrightText),

        siteUrl: merge(stored?.siteUrl, DEFAULT_PUBLIC_SETTINGS.siteUrl),
        metaTitle: merge(stored?.metaTitle, DEFAULT_PUBLIC_SETTINGS.metaTitle),
        metaDescription: merge(
            stored?.metaDescription,
            DEFAULT_PUBLIC_SETTINGS.metaDescription,
        ),

        currency: merge(stored?.currency, DEFAULT_PUBLIC_SETTINGS.currency),
        currencySymbol: merge(stored?.currencySymbol, DEFAULT_PUBLIC_SETTINGS.currencySymbol),
        /*
         * Public because the storefront cannot render a price without them, and
         * a price is on nearly every page. Opted in one line at a time like
         * everything else here — this stays an allow-list.
         */
        currencyPosition: merge(
            stored?.currencyPosition,
            DEFAULT_PUBLIC_SETTINGS.currencyPosition,
        ),
        currencyDecimals: merge(
            stored?.currencyDecimals,
            DEFAULT_PUBLIC_SETTINGS.currencyDecimals,
        ),

        contact: {
            email: merge(stored?.contactEmail, DEFAULT_PUBLIC_SETTINGS.contactEmail),
            phone: merge(stored?.contactPhone, DEFAULT_PUBLIC_SETTINGS.contactPhone),
            address: merge(stored?.address, DEFAULT_PUBLIC_SETTINGS.address),
        },

        mainNav: merge(stored?.mainNav, DEFAULT_PUBLIC_SETTINGS.mainNav),
        footerColumns: merge(stored?.footerColumns, DEFAULT_PUBLIC_SETTINGS.footerColumns),
        socialLinks: merge(stored?.socialLinks, DEFAULT_PUBLIC_SETTINGS.socialLinks),
        announcementBar: merge(stored?.announcementBar, DEFAULT_PUBLIC_SETTINGS.announcementBar),
        newsletter: merge(stored?.newsletter, DEFAULT_PUBLIC_SETTINGS.newsletter),

        /*
         * Both are public because the storefront cannot render a page without
         * them: checkout needs its field config before a shopper has any
         * session, and every page needs the theme to paint. Opted in one line
         * at a time like everything else here — this stays an allow-list, so a
         * column added to StoreSetting later is private until someone says
         * otherwise.
         */
        /*
         * `withDeliveryDefault` rather than a bare `merge`: `merge` swaps the
         * WHOLE value for the fallback, so a row stored before delivery lived
         * in this blob would be served as-is — without `delivery` at all — and
         * the storefront would have no options to render and no flag to read.
         */
        checkoutConfig: withDeliveryDefault(
            merge(stored?.checkoutConfig, DEFAULT_PUBLIC_SETTINGS.checkoutConfig),
        ),
        theme: merge(stored?.theme, DEFAULT_PUBLIC_SETTINGS.theme),

        /*
         * What the storefront routes its ROOT on. Public because it decides
         * what `/` renders, and `/` is fetched before any session exists.
         *
         * The published check is repeated here rather than trusted from the
         * write path. The service refuses to enter LANDING_PAGE mode pointing
         * at a draft, but a row edited straight in the database could still say
         * so — and the failure mode of believing it is a shop whose home page
         * is a 404. Falling back to WEBSITE is the safe direction: the worst
         * case is a merchant seeing their normal homepage and wondering why,
         * rather than every visitor seeing nothing.
         */
        siteMode:
            stored?.siteMode === "LANDING_PAGE" &&
            stored.activeLandingPage?.status === LandingPageStatus.PUBLISHED
                ? "LANDING_PAGE"
                : DEFAULT_PUBLIC_SETTINGS.siteMode,
        activeLandingPage:
            stored?.activeLandingPage?.status === LandingPageStatus.PUBLISHED
                ? {
                      slug: stored.activeLandingPage.slug,
                      title: stored.activeLandingPage.title,
                  }
                : DEFAULT_PUBLIC_SETTINGS.activeLandingPage,
    };
};

/**
 * Supplies `delivery` to a stored config written before delivery lived here.
 *
 * Necessary because `delivery` is a REQUIRED key on `checkoutConfigSchema`, and
 * this schema parses rows that predate it. Without this, every store configured
 * before this change would fail that parse and fall all the way back to
 * DEFAULT_CHECKOUT_CONFIG — silently discarding the merchant's own field, notice
 * and guest-checkout settings until the backfill ran. Filling in the one missing
 * key instead keeps the rest of their config intact, and leaves them with the
 * empty option list a store that has not configured delivery should have.
 *
 * Only fills what is absent. A stored `delivery` is passed through untouched, so
 * this cannot overwrite a merchant's real settings, and a malformed one still
 * fails the parse below rather than being quietly repaired.
 */
const withDeliveryDefault = (stored: unknown): unknown => {
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return stored;
    if ("delivery" in stored) return stored;
    return { ...stored, delivery: DEFAULT_CHECKOUT_CONFIG.delivery };
};

/**
 * The checkout field configuration, for the order path to validate against.
 *
 * Never throws and never returns a partial config. A null column (no merchant
 * has configured checkout yet) and a malformed one (a row edited outside the
 * API) both resolve to DEFAULT_CHECKOUT_CONFIG, which reproduces the checkout's
 * pre-configuration behaviour exactly — so a settings problem degrades to "the
 * old rules" rather than to a checkout nobody can complete.
 *
 * Re-parsed through the schema rather than cast: this is the one place the
 * "reads are trusted" convention does not hold, because the value decides
 * whether an order is accepted.
 */
const getCheckoutConfig = async (): Promise<ICheckoutConfig> => {
    const stored = await prisma.storeSetting.findUnique({
        where: { id: SINGLETON_ID },
        select: { checkoutConfig: true },
    });

    if (!stored?.checkoutConfig) return DEFAULT_CHECKOUT_CONFIG;

    const parsed = checkoutConfigSchema.safeParse(withDeliveryDefault(stored.checkoutConfig));
    return parsed.success ? parsed.data : DEFAULT_CHECKOUT_CONFIG;
};

/**
 * How to write a monetary amount, for the paths that emit one in a message but
 * do not otherwise need the settings row.
 *
 * `findUnique` with a `select`, like `getCheckoutConfig` above and NOT like
 * `getStoreSetting`, which upserts — a message-formatting helper has no business
 * writing to the database. A missing row falls back to the documented defaults
 * rather than throwing: failing to format an error message must not replace the
 * error the caller was actually trying to report.
 */
const getCurrencyFormat = async (): Promise<ICurrencyFormat> => {
    const stored = await prisma.storeSetting.findUnique({
        where: { id: SINGLETON_ID },
        select: { currencySymbol: true, currencyPosition: true, currencyDecimals: true },
    });

    return stored ? currencyFormatOf(stored) : DEFAULT_CURRENCY_FORMAT;
};

/**
 * Refuses a settings save that would leave the storefront root serving nothing.
 *
 * Two rules, both of which need a database read that Zod cannot do — which is
 * why they live here and not in store-setting.validation.ts:
 *
 *   1. LANDING_PAGE mode requires a selected page, and that page must be
 *      PUBLISHED. A mode that resolves to a draft or to a deleted row would
 *      serve a 404 as the shop's home page, which is worse than not switching.
 *   2. The selection cannot be cleared while the mode is on, for the same reason.
 *
 * Run INSIDE the caller's transaction and against the row as it will be after
 * this save — the resolved pair, not just what the payload happens to mention.
 * A merchant flipping the mode on in one tab and a merchant unpublishing the
 * page in another therefore cannot both succeed: whichever commits second reads
 * the first's row and is refused. The mirror of this check lives in
 * landing-page.service.ts, which blocks the unpublish and the delete from the
 * other side.
 */
const assertSiteModeIsServable = async (
    tx: Pick<typeof prisma, "landingPage">,
    resolved: IResolvedSiteMode,
) => {
    // Only LANDING_PAGE mode can be unservable, so only it costs a query.
    const selected =
        resolved.siteMode === SiteMode.LANDING_PAGE && resolved.activeLandingPageId
            ? await tx.landingPage.findUnique({
                  where: { id: resolved.activeLandingPageId },
                  select: { status: true, title: true },
              })
            : null;

    const rejection = siteModeRejection(resolved, selected);

    if (rejection) {
        throw new AppError(status.BAD_REQUEST, rejection);
    }
};

const updateStoreSetting = async (userId: string, payload: IUpdateStoreSettingPayload) => {
    const existing = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });

    const updated = await prisma.$transaction(async (tx) => {
        /*
         * The pair as it will be AFTER this save, not as the payload states it.
         * A PATCH that only flips `siteMode` leaves the existing selection in
         * place, and one that only clears the selection leaves the existing
         * mode in place — either can produce an unservable combination, so both
         * are resolved before either is checked.
         */
        await assertSiteModeIsServable(tx, resolveSiteMode(payload, existing));

        return tx.storeSetting.upsert({
            where: { id: SINGLETON_ID },
            update: payload as Prisma.StoreSettingUpdateInput,
            create: { id: SINGLETON_ID, ...payload } as Prisma.StoreSettingCreateInput,
        });
    });

    // Audit-logged like every other admin mutation in the codebase; settings
    // previously changed without a trail.
    await AuditLogService.record(userId, AuditAction.UPDATE, "StoreSetting", SINGLETON_ID, {
        oldData: existing,
        newData: updated,
    });

    /*
     * Fire-and-forget: the storefront caches this row for five minutes, which
     * without this leaves a merchant unable to tell "saved but cached" from
     * "broken". Deliberately not awaited and deliberately unable to throw — the
     * save has already committed, and a storefront that is down must not turn a
     * successful save into an error.
     */
    revalidateStorefront(STORE_SETTINGS_TAG);

    return updated;
};

export const StoreSettingService = {
    getStoreSetting,
    getPublicStoreSetting,
    getCheckoutConfig,
    getCurrencyFormat,
    updateStoreSetting,
};
