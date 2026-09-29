/**
 * Clearing a landing page's optional hero texts — the badge and sub-headline.
 *
 * Both are `.optional()` on the schema, which alone gives a merchant no way to
 * take one back OFF a page: an omitted key means "leave unchanged", so the
 * admin could send a value or say nothing, and a campaign whose discount had
 * ended was stuck advertising it. `""` now spells "clear it", the same way
 * `facebookPixelId` already did, and the service normalises it to a stored
 * NULL so the column keeps one spelling of empty rather than two.
 *
 * What this pins:
 *   - `""` clears the column, and clears it to NULL, not to `""`.
 *   - An ABSENT key still leaves the stored value alone — the property the
 *     whole partial PATCH depends on, and the one an over-eager fix breaks.
 *   - A real value still round-trips.
 *   - Whitespace-only counts as cleared, so " " cannot store an invisible badge.
 *
 * Creates a `__verify_`-prefixed page and deletes it in a `finally`; touches no
 * existing row. Run with:
 *   npx tsx scripts/verify-landing-page-clear-text.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { LandingPageService } from "../src/app/module/landing-page/landing-page.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const main = async () => {
    // Any product will do; the page only needs one to be valid.
    const product = await prisma.product.findFirst({ select: { id: true } });
    if (!product) {
        console.log("SKIP  no product in the database to attach a landing page to");
        return;
    }

    let pageId: string | null = null;

    try {
        const created = await LandingPageService.createLandingPage(undefined, {
            title: "__verify_clear_text",
            productId: product.id,
            headline: "__verify headline",
            badgeText: "৩০% ছাড়",
            subheadline: "__verify sub",
            bodyHtml: "<p>__verify</p>",
        });
        pageId = created.id;

        check(
            "create stores the badge",
            created.badgeText === "৩০% ছাড়",
            `badgeText = ${JSON.stringify(created.badgeText)}`,
        );

        // The bug this fixes: a changed value must actually land.
        const changed = await LandingPageService.updateLandingPage(undefined, pageId, {
            badgeText: "৫০% ছাড়",
        });
        check(
            "a new value replaces the old one",
            changed.badgeText === "৫০% ছাড়",
            `badgeText = ${JSON.stringify(changed.badgeText)}`,
        );

        // An absent key leaves it alone — what makes the partial PATCH work.
        const untouched = await LandingPageService.updateLandingPage(undefined, pageId, {
            headline: "__verify headline 2",
        });
        check(
            "an absent key leaves the badge alone",
            untouched.badgeText === "৫০% ছাড়",
            `badgeText = ${JSON.stringify(untouched.badgeText)}`,
        );

        // The clear itself, and that it lands as NULL rather than "".
        const cleared = await LandingPageService.updateLandingPage(undefined, pageId, {
            badgeText: "",
        });
        check(
            "an empty string clears the badge to NULL",
            cleared.badgeText === null,
            `badgeText = ${JSON.stringify(cleared.badgeText)}`,
        );
        check(
            "clearing the badge left the sub-headline alone",
            cleared.subheadline === "__verify sub",
            `subheadline = ${JSON.stringify(cleared.subheadline)}`,
        );

        // Whitespace is not a badge.
        await LandingPageService.updateLandingPage(undefined, pageId, { badgeText: "৩০% ছাড়" });
        const blanked = await LandingPageService.updateLandingPage(undefined, pageId, {
            badgeText: "   ",
        });
        check(
            "whitespace-only clears rather than storing an invisible badge",
            blanked.badgeText === null,
            `badgeText = ${JSON.stringify(blanked.badgeText)}`,
        );

        const clearedSub = await LandingPageService.updateLandingPage(undefined, pageId, {
            subheadline: "",
        });
        check(
            "the sub-headline clears the same way",
            clearedSub.subheadline === null,
            `subheadline = ${JSON.stringify(clearedSub.subheadline)}`,
        );

        // Read it back from the database rather than trusting the write's return.
        const stored = await prisma.landingPage.findUnique({
            where: { id: pageId },
            select: { badgeText: true, subheadline: true },
        });
        check(
            "the stored row agrees",
            stored?.badgeText === null && stored?.subheadline === null,
            JSON.stringify(stored),
        );
    } finally {
        if (pageId) {
            await prisma.landingPage.delete({ where: { id: pageId } }).catch(() => {});
        }
    }
};

main()
    .catch((error) => {
        console.error(error);
        failures += 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
        process.exitCode = failures === 0 ? 0 : 1;
    });
