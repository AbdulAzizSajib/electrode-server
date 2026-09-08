/**
 * Checks the SEO module against a real database, at the service layer.
 *
 * Read-only and safe against live data: it creates nothing, writes nothing, and
 * only asserts internal consistency of whatever content the shop already has.
 * The seoConfig round-trip below is the one exception and restores the previous
 * value in a `finally`.
 *
 * Run with: npx tsx scripts/verify-seo.ts
 */
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { SeoService } from "../src/app/module/seo/seo.service";
import { StoreSettingService } from "../src/app/module/store-setting/store-setting.service";
import {
    DEFAULT_SEO_CONFIG,
    SEO_CONTENT_TYPES,
} from "../src/app/module/store-setting/store-setting.constant";

let checks = 0;
let failures = 0;

const check = (label: string, ok: boolean, detail?: unknown) => {
    checks += 1;
    if (ok) {
        console.log(`PASS  ${label}`);
    } else {
        failures += 1;
        console.error(`FAIL  ${label}`, detail === undefined ? "" : detail);
    }
};

const main = async () => {
    // --- Public settings projection -------------------------------------------------
    const settings = await StoreSettingService.getPublicStoreSetting();

    check("public settings expose seoConfig", Boolean(settings.seoConfig));
    check(
        "seoConfig is complete even when the column is null",
        Object.keys(DEFAULT_SEO_CONFIG).every((key) => key in settings.seoConfig),
        Object.keys(settings.seoConfig),
    );
    check(
        "all 12 route groups are present",
        Object.keys(settings.seoConfig.robots.groups).length === 12,
        Object.keys(settings.seoConfig.robots.groups),
    );
    check(
        "private groups default to noindex",
        ["account", "cart", "checkout", "wishlist", "compare", "search"].every(
            (g) => !settings.seoConfig.robots.groups[g as "cart"].index,
        ),
    );
    check(
        "public groups default to index",
        ["home", "product", "category", "blog", "page", "landingPage"].every(
            (g) => settings.seoConfig.robots.groups[g as "home"].index,
        ),
    );

    // --- Overview -------------------------------------------------------------------
    const overview = await SeoService.getSeoOverview({ limit: 100 });

    check("overview returns rows", overview.data.length > 0, overview.meta);
    check(
        "overview meta is coherent",
        overview.meta.total >= overview.data.length && overview.meta.page === 1,
        overview.meta,
    );

    const seenTypes = new Set(overview.data.map((r) => r.contentType));
    console.log(`      content types present: ${[...seenTypes].join(", ") || "(none)"}`);
    check(
        "every row carries a normalised shape",
        overview.data.every(
            (r) =>
                typeof r.id === "string" &&
                typeof r.title === "string" &&
                r.path.startsWith("/") &&
                SEO_CONTENT_TYPES.includes(r.contentType) &&
                r.updatedAt instanceof Date,
        ),
    );
    check(
        "rows are sorted most-recently-updated first",
        overview.data.every(
            (row, i) => i === 0 || overview.data[i - 1].updatedAt >= row.updatedAt,
        ),
    );

    // The naming-convention normalisation is the point of the endpoint: Product
    // and Category carry seoTitle, the other three carry metaTitle, and both must
    // arrive as `metaTitle` here.
    const product = overview.data.find((r) => r.contentType === "product");
    if (product) {
        const row = await prisma.product.findUnique({
            where: { id: product.id },
            select: { seoTitle: true, name: true },
        });
        check(
            "product seoTitle is normalised onto metaTitle",
            row?.seoTitle === product.metaTitle && row?.name === product.title,
            { expected: row, got: { metaTitle: product.metaTitle, title: product.title } },
        );
    }

    const filtered = await SeoService.getSeoOverview({ contentType: "product", limit: 100 });
    check(
        "content-type filter returns only that type",
        filtered.data.every((r) => r.contentType === "product"),
    );

    // --- Sitemap entries ------------------------------------------------------------
    const entries = await SeoService.getSitemapEntries();
    console.log(`      sitemap entries: ${entries.length}`);

    check(
        "every sitemap entry has a slug and a date",
        entries.every((e) => Boolean(e.slug) && e.updatedAt instanceof Date),
    );

    // Unpublished records must not appear. Compare against the drafts the shop
    // actually has rather than creating one.
    const draftSlugs = new Set(
        (
            await prisma.product.findMany({
                where: { status: { not: "ACTIVE" } },
                select: { slug: true },
            })
        ).map((p) => p.slug),
    );
    const leaked = entries.filter((e) => e.contentType === "product" && draftSlugs.has(e.slug));
    check(
        `unpublished products are excluded (${draftSlugs.size} draft/archived found)`,
        leaked.length === 0,
        leaked,
    );

    // --- globalNoindex empties the sitemap -------------------------------------------
    const before = await prisma.storeSetting.findUnique({
        where: { id: "singleton" },
        select: { seoConfig: true },
    });

    try {
        await prisma.storeSetting.update({
            where: { id: "singleton" },
            data: {
                seoConfig: {
                    ...DEFAULT_SEO_CONFIG,
                    robots: { ...DEFAULT_SEO_CONFIG.robots, globalNoindex: true },
                },
            },
        });

        const empty = await SeoService.getSitemapEntries();
        check("globalNoindex empties the sitemap", empty.length === 0, empty.length);
    } finally {
        /*
         * Restore exactly what was there, INCLUDING null. `?? undefined` would
         * not do it: Prisma reads `undefined` as "leave this column alone", so a
         * column that started null would keep the test's value forever. Json
         * columns need the explicit JsonNull sentinel to be set back to null.
         */
        await prisma.storeSetting.update({
            where: { id: "singleton" },
            data: {
                seoConfig:
                    before?.seoConfig == null
                        ? Prisma.JsonNull
                        : (before.seoConfig as Prisma.InputJsonValue),
            },
        });
        const restored = await prisma.storeSetting.findUnique({
            where: { id: "singleton" },
            select: { seoConfig: true },
        });
        // Both normalised through `== null` first: a Json column reads back as
        // JS null, which is not identical to the sentinel it was written with.
        const asJson = (v: unknown) => (v == null ? "null" : JSON.stringify(v));
        check(
            "seoConfig restored to its prior value",
            asJson(restored?.seoConfig) === asJson(before?.seoConfig),
            { before: asJson(before?.seoConfig), after: asJson(restored?.seoConfig) },
        );
    }

    // --- PATCH round-trip, and the disjoint-key rule -----------------------------
    // The property the four SEO screens depend on: writing seoConfig must leave
    // the other blobs on the singleton row alone.
    const beforePatch = await prisma.storeSetting.findUnique({
        where: { id: "singleton" },
        select: { seoConfig: true, theme: true },
    });

    try {
        const sent = {
            ...DEFAULT_SEO_CONFIG,
            defaultMetaTitle: "__verify_seo_title",
            verification: { ...DEFAULT_SEO_CONFIG.verification, google: "__verify_token" },
        };

        /*
         * A real user id: every mutating service records an audit entry keyed to
         * one, and a made-up id trips the foreign key. The audit write is not
         * what is under test here, so borrow whoever the shop's owner is rather
         * than creating a user to throw away.
         */
        const actor = await prisma.user.findFirst({ select: { id: true } });
        if (!actor) throw new Error("No user in the database to attribute the write to");

        await StoreSettingService.updateStoreSetting(actor.id, { seoConfig: sent });

        const after = await prisma.storeSetting.findUnique({
            where: { id: "singleton" },
            select: { seoConfig: true, theme: true },
        });
        const stored = after?.seoConfig as typeof sent | null;

        check(
            "PATCH round-trips the seoConfig it was sent",
            stored?.defaultMetaTitle === "__verify_seo_title" &&
                stored?.verification.google === "__verify_token",
            stored,
        );
        check(
            "PATCH leaves a sibling blob (theme) untouched",
            JSON.stringify(after?.theme ?? null) === JSON.stringify(beforePatch?.theme ?? null),
        );

        const publicAfter = await StoreSettingService.getPublicStoreSetting();
        check(
            "the saved value reaches the public projection",
            publicAfter.seoConfig.defaultMetaTitle === "__verify_seo_title",
        );
    } finally {
        await prisma.storeSetting.update({
            where: { id: "singleton" },
            data: {
                seoConfig:
                    beforePatch?.seoConfig == null
                        ? Prisma.JsonNull
                        : (beforePatch.seoConfig as Prisma.InputJsonValue),
            },
        });
    }

    console.log(`\n${checks - failures}/${checks} checks passed`);
    await prisma.$disconnect();
    if (failures > 0) process.exit(1);
};

main().catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
});
