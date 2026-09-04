import { AuditAction, Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { AuditLogService } from "../audit-log/audit-log.service";
import { revalidateStorefront, STORE_SETTINGS_TAG } from "../../utils/revalidateStorefront";
import {
    DEFAULT_CHECKOUT_CONFIG,
    DEFAULT_PUBLIC_SETTINGS,
    SINGLETON_ID,
} from "./store-setting.constant";
import { ICheckoutConfig, IUpdateStoreSettingPayload } from "./store-setting.interface";
import { checkoutConfigSchema } from "./store-setting.validation";

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
 *     `defaultTaxRatePercent` and `freeShippingThreshold` stay admin-only.
 */
const getPublicStoreSetting = async () => {
    const stored = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });

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
        checkoutConfig: merge(stored?.checkoutConfig, DEFAULT_PUBLIC_SETTINGS.checkoutConfig),
        theme: merge(stored?.theme, DEFAULT_PUBLIC_SETTINGS.theme),
    };
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

    const parsed = checkoutConfigSchema.safeParse(stored.checkoutConfig);
    return parsed.success ? parsed.data : DEFAULT_CHECKOUT_CONFIG;
};

const updateStoreSetting = async (userId: string, payload: IUpdateStoreSettingPayload) => {
    const existing = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });

    const updated = await prisma.storeSetting.upsert({
        where: { id: SINGLETON_ID },
        update: payload as Prisma.StoreSettingUpdateInput,
        create: { id: SINGLETON_ID, ...payload } as Prisma.StoreSettingCreateInput,
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
    updateStoreSetting,
};
