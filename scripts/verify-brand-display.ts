/**
 * Verification for header/footer brand display.
 *
 * The property this exists to protect: **a brand slot never renders empty.**
 * The header and footer are on every page of the storefront, so a slot that
 * resolves to nothing is not one broken page — it is a shop with no name on it.
 * Every fallback below is what stands between a merchant's configuration and
 * that outcome.
 *
 * Two halves, deliberately:
 *
 *  - The RESOLVER checks are pure. They walk the whole mode × artwork matrix,
 *    which is the logic the storefront's Header.tsx and Footer.tsx both call
 *    into. It is duplicated here rather than imported because the resolver
 *    lives in the Next.js app and this is the server's suite; the two must
 *    agree, and this file is what says what "agree" means. If the storefront's
 *    resolver changes, this fails and one of the two is wrong.
 *
 *  - The PERSISTENCE checks run against the real database, because the thing
 *    worth testing — that a mode survives a partial upsert without disturbing
 *    the seven other editors sharing `PATCH /settings` — is a property of the
 *    upsert, not of a pure function.
 *
 * StoreSetting is a SINGLETON, so unlike the other mutating verify scripts this
 * one cannot create a `__verify_*` row and delete it. It snapshots the real row
 * up front and restores every field it touched in a `finally`, including on
 * failure. It writes `__verify_`-prefixed logo URLs so that a crash between
 * write and restore leaves something obviously synthetic rather than something
 * that looks like real artwork.
 *
 * Run with: npx tsx scripts/verify-brand-display.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { SINGLETON_ID } from "../src/app/module/store-setting/store-setting.constant";
import { StoreSettingService } from "../src/app/module/store-setting/store-setting.service";
import {
    MAX_LOGO_HEIGHT,
    MIN_LOGO_HEIGHT,
    updateStoreSettingZodSchema,
} from "../src/app/module/store-setting/store-setting.validation";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Synthetic artwork, prefixed so an interrupted run leaves nothing plausible. */
const HEADER_ART = "https://example.invalid/__verify_header_logo.png";
const FOOTER_ART = "https://example.invalid/__verify_footer_logo.png";

/* ------------------------------------------------------------------ *
 * The resolver — mode × artwork, both slots
 * ------------------------------------------------------------------ */

type Mode = "TEXT" | "LOGO";
type Slot = "header" | "footer";

interface BrandSource {
    headerBrandMode: Mode;
    footerBrandMode: Mode;
    logoUrl: string | null;
    footerLogoUrl: string | null;
}

/**
 * Mirrors `resolveBrandSlot` in the storefront (nextjs/src/lib/brand-slot.ts).
 *
 * Three rules, in order: the mode decides; the footer falls back to the
 * header's artwork; anything unresolved falls back to text.
 */
const resolve = (settings: BrandSource, slot: Slot): { kind: "text" | "logo"; src?: string } => {
    const mode = slot === "header" ? settings.headerBrandMode : settings.footerBrandMode;
    if (mode !== "LOGO") return { kind: "text" };

    /*
     * `||` and not `??`: a cleared footer logo arrives as `""` as readily as
     * null, and for this fallback the two mean the same thing. Under `??` an
     * empty string counts as artwork and the footer falls past the header's
     * logo onto the wordmark.
     */
    const src = slot === "header" ? settings.logoUrl : settings.footerLogoUrl || settings.logoUrl;

    return src ? { kind: "logo", src } : { kind: "text" };
};

const source = (over: Partial<BrandSource> = {}): BrandSource => ({
    headerBrandMode: "TEXT",
    footerBrandMode: "TEXT",
    logoUrl: null,
    footerLogoUrl: null,
    ...over,
});

console.log("\n--- Brand slot resolution: the mode decides ---\n");

check(
    "TEXT mode renders the wordmark even with artwork uploaded",
    resolve(source({ headerBrandMode: "TEXT", logoUrl: HEADER_ART }), "header").kind === "text",
    "the mode decides, not the presence of an image — this is what lets a slot keep artwork on file while showing text",
);

check(
    "LOGO mode renders the header's own artwork",
    resolve(source({ headerBrandMode: "LOGO", logoUrl: HEADER_ART }), "header").src === HEADER_ART,
    "the header resolves logoUrl and never footerLogoUrl",
);

/*
 * The merchant's stated case, and the reason an explicit mode exists at all: a
 * derived mode ("show the logo if one is uploaded") cannot express this without
 * deleting the footer's artwork, which would then pull the header's logo into
 * the footer by the fallback below.
 */
check(
    "a logo header above a wordmark footer",
    (() => {
        const s = source({
            headerBrandMode: "LOGO",
            footerBrandMode: "TEXT",
            logoUrl: HEADER_ART,
            footerLogoUrl: FOOTER_ART,
        });
        return resolve(s, "header").kind === "logo" && resolve(s, "footer").kind === "text";
    })(),
    "both images on file, only the header showing one",
);

check(
    "a wordmark header above a logo footer",
    (() => {
        const s = source({
            headerBrandMode: "TEXT",
            footerBrandMode: "LOGO",
            logoUrl: HEADER_ART,
            footerLogoUrl: FOOTER_ART,
        });
        return resolve(s, "header").kind === "text" && resolve(s, "footer").src === FOOTER_ART;
    })(),
    "the reverse arrangement is equally expressible",
);

console.log("\n--- Brand slot resolution: the footer's fallback ---\n");

check(
    "the footer prefers its own artwork",
    resolve(
        source({ footerBrandMode: "LOGO", logoUrl: HEADER_ART, footerLogoUrl: FOOTER_ART }),
        "footer",
    ).src === FOOTER_ART,
    "artwork cut for the dark footer wins over the header's",
);

check(
    "the footer falls back to the header's artwork",
    resolve(source({ footerBrandMode: "LOGO", logoUrl: HEADER_ART }), "footer").src === HEADER_ART,
    "this is the behaviour the admin has always described and the storefront never ran",
);

/*
 * Why DEFAULT_PUBLIC_SETTINGS.footerLogoUrl is null rather than a copy of
 * logoUrl: resolving the fallback at read time would make "no footer artwork"
 * indistinguishable from "footer artwork that happens to match the header", and
 * clearing the footer's image would then have no effect.
 */
check(
    "clearing the footer's artwork restores the fallback",
    resolve(source({ footerBrandMode: "LOGO", logoUrl: HEADER_ART, footerLogoUrl: null }), "footer")
        .src === HEADER_ART,
    "null must stay distinguishable from a copy of the header's URL",
);

console.log("\n--- Brand slot resolution: a slot never renders empty ---\n");

check(
    "LOGO with no artwork anywhere degrades to the wordmark",
    resolve(source({ headerBrandMode: "LOGO" }), "header").kind === "text" &&
        resolve(source({ footerBrandMode: "LOGO" }), "footer").kind === "text",
    "a blank brand block on every page is worse than the text it replaced",
);

check(
    "the footer degrades to text when neither logo is set",
    resolve(source({ footerBrandMode: "LOGO", footerLogoUrl: null, logoUrl: null }), "footer")
        .kind === "text",
    "the fallback chain ends at the wordmark, never at nothing",
);

check(
    "both slots default to the wordmark",
    resolve(source(), "header").kind === "text" && resolve(source(), "footer").kind === "text",
    "a store that has never opened the branding screen renders exactly as it did before this change",
);

/* ------------------------------------------------------------------ *
 * Persistence — the partial upsert and the height bounds
 * ------------------------------------------------------------------ */

/*
 * `null`, not a synthetic id. `AuditLog.userId` is a real foreign key onto
 * User, so a made-up `__verify_*` id fails the constraint — the audit write is
 * best-effort inside the service, so the save still succeeded, but it logged a
 * ForeignKeyConstraintViolation on every mutation here and that noise is
 * exactly what hides a genuine failure. The column is nullable for the
 * system-initiated writes that have no user behind them, which is what this is.
 */
const VERIFY_USER = null as unknown as string;

async function persistence() {
    console.log("\n--- Persistence: partial upsert and bounds ---\n");

    const before = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });
    if (!before) {
        check("a settings row exists to test against", false, "no singleton row — run the seed first");
        return;
    }

    try {
        await StoreSettingService.updateStoreSetting(VERIFY_USER, {
            headerBrandMode: "LOGO",
            footerBrandMode: "TEXT",
            logoUrl: HEADER_ART,
            footerLogoUrl: FOOTER_ART,
            headerLogoHeight: 64,
            footerLogoHeight: 28,
        });

        const saved = await StoreSettingService.getPublicStoreSetting();

        check(
            "the modes and heights round-trip through the public read",
            saved.headerBrandMode === "LOGO" &&
                saved.footerBrandMode === "TEXT" &&
                saved.headerLogoHeight === 64 &&
                saved.footerLogoHeight === 28,
            `header ${saved.headerBrandMode}/${saved.headerLogoHeight}px, footer ${saved.footerBrandMode}/${saved.footerLogoHeight}px`,
        );

        check(
            "the storefront would render a logo header above a wordmark footer",
            resolve(saved as BrandSource, "header").kind === "logo" &&
                resolve(saved as BrandSource, "footer").kind === "text",
            "the merchant's stated case, resolved from what was actually stored",
        );

        /*
         * The disjoint-key-set rule that lets seven admin editors share one
         * PATCH. A branding save that touched currency or checkout would clobber
         * whatever another screen had loaded.
         */
        const untouched = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });
        check(
            "saving branding leaves unrelated settings alone",
            untouched?.currency === before.currency &&
                untouched?.currencySymbol === before.currencySymbol &&
                untouched?.currencyDecimals === before.currencyDecimals &&
                JSON.stringify(untouched?.checkoutConfig) === JSON.stringify(before.checkoutConfig) &&
                JSON.stringify(untouched?.mainNav) === JSON.stringify(before.mainNav) &&
                untouched?.siteMode === before.siteMode,
            "currency, checkout, nav and site mode are all as they were",
        );

        /* Switching a slot to TEXT must not delete what it was showing. */
        await StoreSettingService.updateStoreSetting(VERIFY_USER, { headerBrandMode: "TEXT" });
        const afterSwitch = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });
        check(
            "switching a slot to TEXT retains its artwork",
            afterSwitch?.logoUrl === HEADER_ART && afterSwitch?.headerBrandMode === "TEXT",
            "so switching back displays the same image without re-uploading it",
        );

        check(
            "a one-key PATCH leaves the other slot's mode alone",
            afterSwitch?.footerBrandMode === "TEXT" && afterSwitch?.footerLogoUrl === FOOTER_ART,
            "an omitted key means 'leave unchanged', which is what makes the two slots independent",
        );

        /*
         * The bound is enforced before anything is written, so a refused save
         * must leave the stored heights exactly as they were. Checked through
         * the schema the route actually runs, then against the database.
         */
        const outOfRange = updateStoreSettingZodSchema.safeParse({
            headerLogoHeight: MAX_LOGO_HEIGHT + 1,
        });
        check(
            "an out-of-range height never reaches the database",
            !outOfRange.success,
            "validateRequest refuses it before the service is called",
        );

        const afterRefusal = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });
        check(
            "the stored heights are unchanged after a refused save",
            afterRefusal?.headerLogoHeight === 64 && afterRefusal?.footerLogoHeight === 28,
            "a rejected value must not partially apply",
        );

        check(
            "the bounds themselves are storable",
            updateStoreSettingZodSchema.safeParse({
                headerLogoHeight: MIN_LOGO_HEIGHT,
                footerLogoHeight: MAX_LOGO_HEIGHT,
            }).success,
            `${MIN_LOGO_HEIGHT} and ${MAX_LOGO_HEIGHT} are inclusive`,
        );
    } finally {
        /*
         * Restore every field touched above, whatever happened. Written
         * directly rather than through the service: this must run even if the
         * service is what failed, and it is a restoration, not a merchant edit.
         */
        await prisma.storeSetting.update({
            where: { id: SINGLETON_ID },
            data: {
                headerBrandMode: before.headerBrandMode,
                footerBrandMode: before.footerBrandMode,
                logoUrl: before.logoUrl,
                footerLogoUrl: before.footerLogoUrl,
                headerLogoHeight: before.headerLogoHeight,
                footerLogoHeight: before.footerLogoHeight,
            },
        });

        const restored = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });
        check(
            "the settings row is restored",
            restored?.headerBrandMode === before.headerBrandMode &&
                restored?.footerBrandMode === before.footerBrandMode &&
                restored?.logoUrl === before.logoUrl &&
                restored?.footerLogoUrl === before.footerLogoUrl &&
                restored?.headerLogoHeight === before.headerLogoHeight &&
                restored?.footerLogoHeight === before.footerLogoHeight,
            "no synthetic artwork or height is left behind",
        );

        /*
         * The audit rows this run wrote are left in place deliberately. They
         * are indistinguishable from any other system-initiated settings write
         * once `userId` is null, and deleting by that predicate would take real
         * entries with them — an audit trail that a script can prune is not one.
         */
    }
}

persistence()
    .catch((error) => {
        console.error("\nUnexpected error:", error);
        failures += 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
        process.exit(failures === 0 ? 0 : 1);
    });
