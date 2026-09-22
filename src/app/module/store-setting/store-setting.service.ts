import status from "http-status";
import {
    AuditAction,
    CourierProvider,
    LandingPageStatus,
    Prisma,
    SiteMode,
} from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { AuditLogService } from "../audit-log/audit-log.service";
import { CourierService } from "../courier/courier.service";
import {
    revalidateStorefront,
    SEO_CONFIG_TAG,
    STORE_SETTINGS_TAG,
} from "../../utils/revalidateStorefront";
import {
    DEFAULT_CHECKOUT_CONFIG,
    DEFAULT_HOME_CONFIG,
    DEFAULT_PUBLIC_SETTINGS,
    HOME_SECTION_KEYS,
    HomeSectionConfig,
    HomeSectionKey,
    HomeSectionVariant,
    resolveSectionVariant,
    SINGLETON_ID,
} from "./store-setting.constant";
import {
    ICheckoutConfig,
    ICurrencyFormat,
    ISeoConfig,
    ITheme,
    IUpdateStoreSettingPayload,
} from "./store-setting.interface";
import {
    IResolvedSiteMode,
    resolveSiteMode,
    siteModeRejection,
} from "./store-setting.site-mode";
import { checkoutConfigSchema } from "./store-setting.validation";
import { currencyFormatOf, DEFAULT_CURRENCY_FORMAT } from "../../utils/formatMoney";

/**
 * Get-or-create on the fixed singleton id — there is no way, through this
 * service, to end up with a second row.
 *
 * Read first, create only when missing, rather than `upsert({ update: {} })`.
 * An upsert with an empty update cannot become a native `INSERT … ON CONFLICT`,
 * so Prisma emulates it as BEGIN + three SELECTs + COMMIT: five database round
 * trips on every checkout quote and order placement to read a row that exists
 * from the first boot onward. The id is the primary key, so two first-boot
 * creates cannot both succeed; the loser (P2002) reads back the winner.
 */
const getStoreSetting = async () => {
    const existing = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });
    if (existing) return existing;

    try {
        return await prisma.storeSetting.create({ data: { id: SINGLETON_ID } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return prisma.storeSetting.findUniqueOrThrow({ where: { id: SINGLETON_ID } });
        }
        throw error;
    }
};

/**
 * Fills a stored `seoConfig` out to a complete one, level by level.
 *
 * Written out per level rather than as a generic recursive deep-merge because
 * the two leaf collections must NOT be merged: `sameAs` and the group flags are
 * replaced wholesale when present. A recursive merge would union `sameAs` with
 * the defaults, which makes removing a social profile impossible — the same
 * reason the write path replaces the blob instead of deep-merging it.
 *
 * `robots.groups` is spread per key so a group added after a row was written
 * reads at its default rather than `undefined`; `undefined.index` is falsy, and
 * a page dropped from search by omission is the failure this whole function
 * exists to prevent.
 */
const mergeSeoConfig = (stored: unknown): ISeoConfig => {
    const defaults = DEFAULT_PUBLIC_SETTINGS.seoConfig;
    // Not an object (null, or a row edited by hand into something else): take
    // the defaults whole rather than reading keys off a value that has none.
    if (typeof stored !== "object" || stored === null) return defaults as ISeoConfig;

    const s = stored as Record<string, undefined | Record<string, unknown>>;
    const robots = s.robots ?? {};
    const structuredData = s.structuredData ?? {};

    return {
        ...defaults,
        ...s,
        robots: {
            ...defaults.robots,
            ...robots,
            groups: {
                ...defaults.robots.groups,
                ...((robots.groups as object | undefined) ?? {}),
            },
        },
        sitemap: { ...defaults.sitemap, ...((s.sitemap as object | undefined) ?? {}) },
        structuredData: {
            ...defaults.structuredData,
            ...structuredData,
            organization: {
                ...defaults.structuredData.organization,
                ...((structuredData.organization as object | undefined) ?? {}),
            },
        },
        verification: { ...defaults.verification, ...((s.verification as object | undefined) ?? {}) },
    } as ISeoConfig;
};

/**
 * Fills a stored `homeConfig` out to a complete, current section list.
 *
 * Neither `merge()` below nor the per-key spread `catalogConfig` uses applies
 * here: both repair an OBJECT against a default object, and this value is an
 * ORDERED ARRAY whose order is itself the data. So it gets its own read rule:
 *
 *   1. keep stored entries whose key is still in the registry, in stored order,
 *      collapsing a repeated key to its FIRST occurrence;
 *   2. splice every registry section the stored list does not mention back in,
 *      ENABLED, at its registry-relative position;
 *   3. a value that is not an array at all resolves to the full default list.
 *
 * STEP 2 IS THE LOAD-BEARING ONE. Without it, a section added in a later
 * release would never render for any shop that had already saved a config — the
 * key simply would not be in their stored list, and nothing would put it there.
 * That is indistinguishable from the new section being broken, and it would
 * need a data migration over every row to fix. With it, adding a section to
 * HOME_SECTION_KEYS is the whole job.
 *
 * Enabled rather than disabled on that splice, for the same reason
 * DEFAULT_HOME_CONFIG is all-enabled: it reproduces what the storefront would
 * do if the setting did not exist. A merchant who does not want the new section
 * turns it off; a merchant who never notices still gets the homepage the
 * release intended.
 *
 * "Absent from the list" is the trigger, NOT "the list is empty". An explicitly
 * disabled section is still IN the list, carrying `enabled: false`, so it is
 * never re-added — which is what makes the all-sections-off homepage a
 * reachable state rather than one that silently heals back to the default.
 *
 * Read-side only, and deliberately forgiving: `homeConfigSchema` already
 * rejects duplicates and unknown keys on the WRITE path, so anything this
 * repairs arrived by a route the API does not control — a hand-edited row, or a
 * config written before the registry changed. A homepage that throws is worse
 * than one that ignores a corrupt value, which is the same direction
 * `resolveSiteMode` fails in below.
 *
 * A SECTION'S LAYOUT IS RESOLVED HERE TOO, on exactly the same principle as the
 * key list: the response always carries a complete, current answer, so no client
 * ever has to default one. A stored layout that is still offered is reported as
 * stored; one that is absent, unrecognised, or belongs to a layout since
 * withdrawn resolves to that section's default. Nothing is rewritten — this is a
 * read rule, and a store whose row predates layouts keeps reading as the default
 * without a migration.
 *
 * THAT RESOLUTION IS ALSO THE EASIEST THING TO BREAK HERE, and it breaks
 * silently. This function REBUILDS each entry rather than passing it through, so
 * a `variant` that is not carried explicitly through both the map below and the
 * two rebuild paths is dropped on the way out — the merchant's choice saves,
 * persists correctly, and is gone on the very next read. It passes every manual
 * test that does not reload the page. See
 * openspec/changes/add-hero-section-variants, design.md Decision 4.
 *
 * See openspec/changes/add-homepage-section-toggles, design.md Decision 2.
 */

/**
 * One section entry with its layout resolved, for the paths where nothing was
 * stored — the non-array fallback and the splice. Returns a NEW object rather
 * than mutating, so DEFAULT_HOME_CONFIG is never written through.
 */
const withVariant = (section: HomeSectionConfig): HomeSectionConfig => {
    const variant = resolveSectionVariant(section.key, section.variant);
    return variant === undefined
        ? { key: section.key, enabled: section.enabled }
        : { key: section.key, enabled: section.enabled, variant };
};

export const reconcileHomeConfig = (stored: unknown): HomeSectionConfig[] => {
    if (!Array.isArray(stored)) return DEFAULT_HOME_CONFIG.map(withVariant);

    const registry = new Set<string>(HOME_SECTION_KEYS);
    const seen = new Map<HomeSectionKey, { enabled: boolean; variant?: HomeSectionVariant }>();

    for (const entry of stored) {
        if (typeof entry !== "object" || entry === null) continue;

        const { key, enabled, variant } = entry as {
            key?: unknown;
            enabled?: unknown;
            variant?: unknown;
        };

        // An unregistered key is dropped rather than carried: a section removed
        // from the registry has no component left to render, and passing it
        // through would hand the storefront a key it cannot map.
        if (typeof key !== "string" || !registry.has(key)) continue;
        // First occurrence wins — see the duplicate note above.
        if (seen.has(key as HomeSectionKey)) continue;

        // A non-boolean `enabled` is treated as ON, matching the splice
        // direction: the safe failure is showing a section, not hiding one.
        // `variant` is resolved rather than trusted, so an unrecognised string
        // becomes the default instead of reaching a client that cannot render
        // it.
        seen.set(key as HomeSectionKey, {
            enabled: enabled !== false,
            variant: resolveSectionVariant(key as HomeSectionKey, variant),
        });
    }

    /*
     * Rebuilt in stored order, then missing sections inserted at their registry
     * position. Walking the registry and asking "where does this go" would lose
     * the merchant's ordering; walking the stored list and appending the
     * remainder would drop every new section to the bottom of the page
     * regardless of where it belongs. So: walk the registry to find the gaps,
     * and splice each one against its nearest already-placed neighbour.
     */
    const ordered: HomeSectionConfig[] = [];

    for (const [key, { enabled, variant }] of seen) {
        // `variant` omitted entirely, not set to undefined, for a section that
        // offers no choice — otherwise eleven of the twelve entries would carry
        // a dead key into every settings response.
        ordered.push(variant === undefined ? { key, enabled } : { key, enabled, variant });
    }

    HOME_SECTION_KEYS.forEach((key, registryIndex) => {
        if (seen.has(key)) return;

        /*
         * The insertion point is just after the last section that precedes this
         * one in the REGISTRY and is already placed. With nothing before it,
         * that is the front of the list — so a section added at the top of the
         * registry lands at the top of the merchant's page rather than the
         * bottom.
         */
        const precedingKeys = new Set(HOME_SECTION_KEYS.slice(0, registryIndex));

        let insertAt = 0;

        ordered.forEach((section, index) => {
            if (precedingKeys.has(section.key)) insertAt = index + 1;
        });

        // The SECOND rebuild path, and it needs the layout as much as the first:
        // a section spliced in here has never been saved, so its layout can only
        // be the default — but it still has to be PRESENT, or the hero arrives
        // without one for every store that predates the section.
        ordered.splice(insertAt, 0, withVariant({ key, enabled: true }));
    });

    return ordered;
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
        /*
         * Public because the storefront emits it in the document head of every
         * page it serves, before any shopper session exists. A scalar, so a
         * plain `merge` is right here — there is no nested key to repair, and
         * nothing for a `catalogConfig`-style per-key spread to do.
         *
         * Null reaches the storefront as null, which is the answer: it means
         * "the merchant chose nothing", and the storefront resolves that to its
         * own shipped icon.
         */
        faviconUrl: merge(stored?.faviconUrl, DEFAULT_PUBLIC_SETTINGS.faviconUrl),
        /*
         * Public for the same reason the logos above are: the storefront cannot
         * draw its header or footer without knowing which of the two things
         * each slot shows. Opted in one line at a time — this stays an
         * allow-list. A row predating these columns merges to TEXT, which is
         * what the storefront rendered before they existed.
         */
        headerBrandMode: merge(stored?.headerBrandMode, DEFAULT_PUBLIC_SETTINGS.headerBrandMode),
        footerBrandMode: merge(stored?.footerBrandMode, DEFAULT_PUBLIC_SETTINGS.footerBrandMode),
        headerLogoHeight: merge(stored?.headerLogoHeight, DEFAULT_PUBLIC_SETTINGS.headerLogoHeight),
        footerLogoHeight: merge(stored?.footerLogoHeight, DEFAULT_PUBLIC_SETTINGS.footerLogoHeight),
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
        /*
         * `merge` substitutes only on null/undefined, which is what this field
         * needs: an EMPTY ARRAY is a merchant who cleared the row and must be
         * served as empty, while null is a column never written and takes the
         * default. Swapping in the default for a falsy value would make "no
         * links" impossible to express.
         */
        middleBarLinks: merge(stored?.middleBarLinks, DEFAULT_PUBLIC_SETTINGS.middleBarLinks),
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

        /*
         * Public for the same reason the theme is: the storefront decides what
         * to render from these before any shopper session exists, and it needs
         * them on every page that shows a product. Opted in one line like
         * everything else here — this stays an allow-list. There is nothing to
         * leak either way: three booleans describing which controls a shop
         * offers are already obvious to anyone who loads the storefront.
         *
         * A PER-KEY SPREAD, not the wholesale `merge()` above. `merge()` swaps
         * the entire stored value for the fallback, so a blob written before a
         * key existed is served WITHOUT that key — which is precisely what
         * forced `withDeliveryDefault` into existence one line up. This blob is
         * a flat map of booleans and is certain to gain more, so it is read the
         * right way from the start and never needs a shim of its own. A missing
         * flag reads at its default instead of `undefined`, which is falsy and
         * would withdraw the feature by accident.
         */
        catalogConfig: {
            ...DEFAULT_PUBLIC_SETTINGS.catalogConfig,
            ...((stored?.catalogConfig as object | null) ?? {}),
        },

        /*
         * Which sections the homepage is composed of, and in what order.
         *
         * Public because the homepage decides what to render from it before any
         * shopper session exists, and it travels on the settings payload the
         * storefront ALREADY fetches in its layout on every page — so routing
         * the homepage costs no second request and needs no second cache, the
         * same reasoning `siteMode` below is on this row for. Opted in one line
         * like everything else here; this stays an allow-list. Nothing leaks: a
         * list of which blocks a shop shows is apparent to anyone who loads it.
         *
         * NEITHER `merge()` NOR the per-key spread one block up. Both repair an
         * object against a default object; this value is an ordered array, and
         * spreading two arrays by key would produce nonsense. `merge()` would
         * be worse than useless — it only substitutes when the whole value is
         * null, so a config saved before a section existed would be served
         * as-is, permanently missing that section. That is precisely the bug
         * `withDeliveryDefault` exists to paper over for checkoutConfig, and
         * reconcileHomeConfig is how this column avoids ever needing one.
         */
        homeConfig: reconcileHomeConfig(stored?.homeConfig),

        /*
         * A PER-KEY merge with a nested repair for both font keys, not the
         * wholesale `merge()` this used to be — the same correction
         * `withDeliveryDefault` and `catalogConfig` above already carry.
         *
         * `merge()` swaps the WHOLE stored value for the fallback only when it
         * is null, so a theme row written before `adminFont` existed — which is
         * every row in every existing install — was served exactly as stored,
         * i.e. with no `adminFont` at all. The admin panel would then have
         * nothing to read and would sit on its fallback stack permanently,
         * looking like the setting simply did not work.
         *
         * The two nested spreads matter for the same reason one level up would
         * not be enough: a stored `font` carrying a `family` but no `url` (a
         * row hand-edited, or written by a partial migration) would otherwise
         * be served with the family and no stylesheet to load it from. Repaired
         * per key, a half-written font resolves the missing half from the
         * default and still renders.
         */
        theme: {
            ...DEFAULT_PUBLIC_SETTINGS.theme,
            ...((stored?.theme as object | null) ?? {}),
            font: {
                ...DEFAULT_PUBLIC_SETTINGS.theme.font,
                ...(((stored?.theme as { font?: object } | null)?.font as object | undefined) ??
                    {}),
            },
            adminFont: {
                ...DEFAULT_PUBLIC_SETTINGS.theme.adminFont,
                ...(((stored?.theme as { adminFont?: object } | null)
                    ?.adminFont as object | undefined) ?? {}),
            },
        },

        /*
         * Public because metadata is rendered on every page, before any session
         * exists — and because the sitemap and robots routes read it too. There
         * is nothing to leak: every value here is emitted into the HTML the
         * moment it is set.
         *
         * A DEEP merge, not the per-key spread `catalogConfig` uses one block
         * up. That spread repairs a flat map; this blob is nested three levels,
         * so a one-level spread would swap a whole `robots` or `structuredData`
         * subtree for the stored one and lose any key added since it was
         * written. For an `index` flag that reads as `undefined` — falsy — and
         * withdraws a page from search by omission. See mergeSeoConfig.
         */
        seoConfig: mergeSeoConfig(stored?.seoConfig),

        /*
         * The shop-wide Meta pixel, and ONLY the pixel.
         *
         * Public because the storefront cannot fire a pixel it cannot read, and
         * because a pixel id is published to every visitor by the very act of
         * using it — it is interpolated into a script tag on every page, so
         * withholding it here would cost a round trip and buy nothing.
         *
         * WHAT IS DELIBERATELY ABSENT IS THE POINT. `integrationConfig` also
         * carries `facebookCapi`, whose settings are for the SERVER to read; and
         * the CAPI access token is not on this row at all, it is encrypted in
         * `IntegrationCredential`. Projecting one named sub-object rather than
         * the whole column is what keeps this an allow-list: a field added to
         * `integrationConfig` later is private until someone opts it in here,
         * which is exactly the property a public endpoint needs.
         *
         * Per-key spread against the default, like `catalogConfig` above and for
         * the same reason: a blob written before a key existed would otherwise
         * be served without it, and a missing `enabled` reads as `undefined` —
         * falsy — which withdraws the feature by accident.
         */
        facebookPixel: {
            ...DEFAULT_PUBLIC_SETTINGS.facebookPixel,
            ...(((stored?.integrationConfig as { facebookPixel?: object } | null)
                ?.facebookPixel as object | undefined) ?? {}),
        },

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

    return checkoutConfigOf(stored?.checkoutConfig);
};

/**
 * The same parse as `getCheckoutConfig`, over a column the caller already
 * holds — for order placement, which reads the settings row once and derives
 * everything it needs from it rather than going back to the database for each
 * piece. Same guarantees: never throws, never partial.
 */
const checkoutConfigOf = (stored: Prisma.JsonValue | null | undefined): ICheckoutConfig => {
    if (!stored) return DEFAULT_CHECKOUT_CONFIG;

    const parsed = checkoutConfigSchema.safeParse(withDeliveryDefault(stored));
    return parsed.success ? parsed.data : DEFAULT_CHECKOUT_CONFIG;
};

/**
 * How to write a monetary amount, for the paths that emit one in a message but
 * do not otherwise need the settings row.
 *
 * `findUnique` with a `select`, like `getCheckoutConfig` above and NOT like
 * `getStoreSetting`, which creates the row when it is missing — a
 * message-formatting helper has no business writing to the database. A missing row falls back to the documented defaults
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

/**
 * Refuses a courier switch that would strand parcels already in flight.
 *
 * Every consignment is polled against the provider that CREATED it, using that
 * provider's credentials (`Shipment.courierProvider`). So a switch made while
 * parcels are out does not break them — but it is still the wrong moment: the
 * merchant's old courier account is funded and their new one may not even be
 * configured, and an operator watching statuses stop moving has no way to
 * connect that to a setting they changed.
 *
 * The refusal names the COUNT rather than saying "not allowed", because "23
 * parcels are still in transit" tells the merchant when to try again.
 *
 * "In flight" is the same non-terminal set reconciliation polls, read from
 * `CourierService` so the two cannot disagree about what settled means.
 * `unknown` counts as in flight deliberately — it is the courier telling us to
 * contact support, which is the opposite of settled.
 *
 * Runs INSIDE the caller's transaction, against the provider being switched
 * AWAY from. A payload that does not mention `courierProvider`, or names the one
 * already configured, costs nothing.
 *
 * See openspec/changes/add-courier-provider-selection, design.md Decision 4.
 */
const assertCourierSwitchIsSafe = async (
    payload: IUpdateStoreSettingPayload,
    existing: { courierProvider: CourierProvider } | null,
) => {
    const next = payload.courierProvider;

    if (!next) return;

    const current = existing?.courierProvider ?? CourierProvider.STEADFAST;

    if (next === current) return;

    const inFlight = await CourierService.countInFlightConsignments(current);

    if (inFlight > 0) {
        throw new AppError(
            status.CONFLICT,
            `${inFlight} ${inFlight === 1 ? "consignment is" : "consignments are"} still in transit with the current courier. Wait for ${inFlight === 1 ? "it" : "them"} to be delivered or cancelled before switching couriers.`,
        );
    }
};

/**
 * Turns the theme's font selections into the `{ family, url }` pairs actually
 * stored.
 *
 * `themeSchema` accepts a font two ways (see fontSchema there): as a pasted
 * embed, which Zod has already parsed into `{ family, url }` by the time it
 * reaches here, or as `{ family }` — a pick from the font library. Only the
 * second needs anything doing: the family has to be looked up to get its
 * stylesheet URL, and that is a database read, which is why it happens here and
 * not in validation.
 *
 * Rejecting an unknown family matters more than it looks. The alternative —
 * storing the name and no URL — would render as the fallback stack on every
 * page with nothing anywhere saying why, and a merchant would reasonably read
 * that as the font feature being broken.
 *
 * `adminFont` is carried forward when the payload omits it. It is the one
 * optional key in an otherwise write-whole blob, so an older caller that sends
 * a complete theme without it must not blank the admin's typeface.
 *
 * See openspec/changes/add-font-library-and-admin-font, design.md Decision 3.
 */
const resolveThemeFonts = async (
    tx: Prisma.TransactionClient,
    payload: IUpdateStoreSettingPayload,
    existing: { theme: Prisma.JsonValue } | null,
): Promise<IUpdateStoreSettingPayload> => {
    const theme = payload.theme as Record<string, unknown> | undefined;

    if (!theme) {
        return payload;
    }

    const resolveOne = async (value: unknown, label: string) => {
        /*
         * Already `{ family, url }` — which can ONLY be Zod's own transform
         * output, never caller input: `fontSelectionSchema` is `.strict()`, so
         * a request that sends a `url` alongside a `family` is rejected outright
         * rather than stripped. That is what makes trusting this branch safe.
         * If that `.strict()` is ever removed, this becomes a hole straight
         * past the parser and into the column.
         */
        if (
            value &&
            typeof value === "object" &&
            "url" in (value as object) &&
            "family" in (value as object)
        ) {
            return value;
        }

        if (value && typeof value === "object" && "family" in (value as object)) {
            const family = String((value as { family: unknown }).family);

            const font = await tx.font.findFirst({
                where: { family: { equals: family, mode: "insensitive" } },
            });

            if (!font) {
                throw new AppError(
                    status.BAD_REQUEST,
                    `"${family}" is not in the font library. Add it under UI → Fonts first.`,
                );
            }

            return { family: font.family, url: font.url };
        }

        throw new AppError(status.BAD_REQUEST, `The ${label} font is not in a recognised form.`);
    };

    const storedTheme = (existing?.theme as Record<string, unknown> | null) ?? null;

    const resolved: Record<string, unknown> = {
        ...theme,
        font: await resolveOne(theme.font, "storefront"),
    };

    if (theme.adminFont !== undefined) {
        resolved.adminFont = await resolveOne(theme.adminFont, "admin panel");
    } else if (storedTheme?.adminFont !== undefined) {
        // Omitted by an older caller: keep what is there rather than dropping it.
        resolved.adminFont = storedTheme.adminFont;
    }

    return { ...payload, theme: resolved as unknown as ITheme };
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

        await assertCourierSwitchIsSafe(payload, existing);

        const resolvedPayload = await resolveThemeFonts(tx, payload, existing);

        return tx.storeSetting.upsert({
            where: { id: SINGLETON_ID },
            update: resolvedPayload as Prisma.StoreSettingUpdateInput,
            create: { id: SINGLETON_ID, ...resolvedPayload } as Prisma.StoreSettingCreateInput,
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

    /*
     * Both tags, on every settings save. `seoConfig` travels inside the settings
     * payload, so the first tag already covers page metadata — but the sitemap
     * and robots routes cache separately on this one, and they read the same
     * config. Firing it unconditionally rather than only when `seoConfig` is in
     * the payload: `siteUrl` lives in a column of its own and every sitemap URL
     * is built from it, so "did this write touch SEO" is not a question the
     * payload's keys can answer.
     */
    revalidateStorefront(SEO_CONFIG_TAG);

    return updated;
};

export const StoreSettingService = {
    getStoreSetting,
    getPublicStoreSetting,
    getCheckoutConfig,
    checkoutConfigOf,
    getCurrencyFormat,
    updateStoreSetting,
};
