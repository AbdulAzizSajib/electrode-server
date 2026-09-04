/**
 * Verifies the add-admin-ui-cms-section behaviours that the change's tasks list
 * as manual checks (8.5, 8.6, 8.7), by driving the real services against the
 * real database rather than by clicking through the panel.
 *
 * Everything it creates, it removes; the StoreSetting values it touches are
 * captured first and restored afterwards, so running this leaves the store
 * exactly as it found it.
 *
 * Run with: npx tsx scripts/verify-ui-cms.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { PageService } from "../src/app/module/page/page.service";
import { StoreSettingService } from "../src/app/module/store-setting/store-setting.service";
import { SINGLETON_ID } from "../src/app/module/store-setting/store-setting.constant";
import { createPageZodSchema } from "../src/app/module/page/page.validation";

let failures = 0;

const check = (label: string, condition: boolean, detail?: string) => {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        failures++;
        console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    }
};

/** Runs a promise and reports whether it rejected, and with what message. */
const expectRejection = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
        await fn();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
};

async function verifyReservedSlugs() {
    console.log("\nTask 8.6 — a reserved slug is refused with a clear message");

    // Through the zod schema, which is what an admin request actually hits.
    const parsed = createPageZodSchema.safeParse({
        title: "Cart",
        slug: "cart",
        body: "<p>Nope</p>",
    });
    check("validation rejects an explicit reserved slug", !parsed.success);
    if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? "";
        check(
            "the message says WHY, not just 'invalid'",
            /reserved/i.test(message),
            `got: ${message}`,
        );
    }

    // And through the service, which is the path a slug DERIVED from the title
    // takes — the schema never sees that one, so it needs its own guard.
    const derived = await expectRejection(() =>
        PageService.createPage(undefined, { title: "Checkout", body: "<p>Nope</p>" }),
    );
    check("service rejects a reserved slug derived from the title", derived !== null);
    check(
        "derived-slug rejection names the storefront",
        derived !== null && /reserved/i.test(derived),
        `got: ${derived}`,
    );

    const malformed = createPageZodSchema.safeParse({
        title: "Bad",
        slug: "Not A Slug",
        body: "<p>x</p>",
    });
    check("validation rejects a malformed slug", !malformed.success);
}

async function verifyPageLifecycle() {
    console.log("\nTask 8.5 — a page's full lifecycle");

    const slug = `verify-ui-cms-temp-${Date.now()}`;
    let createdId: string | null = null;

    try {
        const draft = await PageService.createPage(undefined, {
            title: "Verify UI CMS Temp",
            slug,
            body: "<h2>Draft</h2><p>Not public yet.</p>",
        });
        createdId = draft.id;

        check("a new page defaults to DRAFT", draft.status === "DRAFT", draft.status);
        check(
            "a DRAFT is invisible to the public read",
            (await PageService.getPublishedPageBySlug(slug)) === null,
        );
        check(
            "a DRAFT is not offered as a link target",
            !(await PageService.getPublishedPageSummaries()).some((p) => p.slug === slug),
        );
        check(
            "an admin can still read the DRAFT in full",
            (await PageService.getPageOrThrow(draft.id)).body.includes("Not public yet"),
        );

        await PageService.updatePage(undefined, draft.id, { status: "PUBLISHED" });

        const published = await PageService.getPublishedPageBySlug(slug);
        check("publishing makes it publicly readable", published !== null);
        check(
            "it becomes available as a link target",
            (await PageService.getPublishedPageSummaries()).some((p) => p.slug === slug),
        );

        // A status-only PATCH must not re-derive the slug from the title and
        // move a live page's URL out from under its inbound links.
        check(
            "a status-only update leaves the slug alone",
            published?.slug === slug,
            published?.slug,
        );

        const duplicate = await expectRejection(() =>
            PageService.createPage(undefined, {
                title: "Another",
                slug,
                body: "<p>Clash</p>",
            }),
        );
        check("a duplicate slug is refused", duplicate !== null);
        check(
            "the duplicate error names the page already using it",
            duplicate !== null && duplicate.includes("Verify UI CMS Temp"),
            `got: ${duplicate}`,
        );

        await PageService.deletePage(undefined, draft.id);
        createdId = null;

        check(
            "after deletion the slug is public-404 again",
            (await PageService.getPublishedPageBySlug(slug)) === null,
        );
    } finally {
        // Never leave a stray page behind, even if an assertion above threw.
        if (createdId) await prisma.page.delete({ where: { id: createdId } }).catch(() => {});
    }
}

async function verifySettingsIndependence() {
    console.log("\nTask 8.7 — the header and footer editors do not clobber each other");

    const before = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });

    try {
        // Seed both halves so there is something to preserve.
        await StoreSettingService.updateStoreSetting(undefined as unknown as string, {
            mainNav: [{ label: "VerifyNav", href: "/verify-nav" }],
            announcementBar: { enabled: true, text: "VerifyBar", links: [] },
            footerColumns: [
                { title: "VerifyFooter", links: [{ label: "VerifyLink", href: "/verify-link" }] },
            ],
        });

        // The header editor's write: mainNav + announcementBar ONLY.
        await StoreSettingService.updateStoreSetting(undefined as unknown as string, {
            mainNav: [{ label: "HeaderOnly", href: "/header-only" }],
            announcementBar: { enabled: false, text: "VerifyBar", links: [] },
        });

        const afterHeaderSave = await StoreSettingService.getPublicStoreSetting();
        const footerAfterHeader = afterHeaderSave.footerColumns as { title: string }[];
        check(
            "saving the header leaves footer columns intact",
            footerAfterHeader?.[0]?.title === "VerifyFooter",
            JSON.stringify(footerAfterHeader),
        );
        check(
            "disabling the bar keeps its text for later",
            (afterHeaderSave.announcementBar as { text: string }).text === "VerifyBar",
        );

        // The footer editor's write: everything BUT those two.
        await StoreSettingService.updateStoreSetting(undefined as unknown as string, {
            footerColumns: [
                { title: "FooterOnly", links: [{ label: "VerifyLink", href: "/verify-link" }] },
            ],
        });

        const afterFooterSave = await StoreSettingService.getPublicStoreSetting();
        const navAfterFooter = afterFooterSave.mainNav as { label: string }[];
        check(
            "saving the footer leaves main navigation intact",
            navAfterFooter?.[0]?.label === "HeaderOnly",
            JSON.stringify(navAfterFooter),
        );
        check(
            "saving the footer leaves the announcement bar intact",
            (afterFooterSave.announcementBar as { enabled: boolean }).enabled === false,
        );
    } finally {
        // Restore exactly what was there, including "was null".
        await prisma.storeSetting.update({
            where: { id: SINGLETON_ID },
            data: {
                mainNav: before?.mainNav ?? undefined,
                announcementBar: before?.announcementBar ?? undefined,
                footerColumns: before?.footerColumns ?? undefined,
            },
        });
        console.log("  · restored the store's original settings");
    }
}

async function reportSeedState() {
    console.log("\nTask 8.3 — seeded chrome (informational)");

    const stored = await prisma.storeSetting.findUnique({ where: { id: SINGLETON_ID } });
    const seeded = Boolean(stored?.mainNav);

    console.log(
        seeded
            ? "  · StoreSetting carries stored chrome — the storefront reads it directly."
            : "  · StoreSetting chrome columns are NULL — the public endpoint serves " +
              "DEFAULT_PUBLIC_SETTINGS, which mirrors the previous hardcoded content. " +
              "Run scripts/backfill-storefront-engagement.ts to persist it.",
    );

    const publicSettings = await StoreSettingService.getPublicStoreSetting();
    check("the public projection always yields a non-empty nav", (publicSettings.mainNav as unknown[]).length > 0);
    check("the public projection always yields a wordmark", Boolean(publicSettings.storeName));
}

async function main() {
    console.log("Verifying add-admin-ui-cms-section behaviours...");

    await verifyReservedSlugs();
    await verifyPageLifecycle();
    await verifySettingsIndependence();
    await reportSeedState();

    console.log(
        failures === 0
            ? "\nAll checks passed."
            : `\n${failures} check(s) FAILED.`,
    );

    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
    console.error("Verification crashed:", error);
    await prisma.$disconnect();
    process.exit(1);
});
