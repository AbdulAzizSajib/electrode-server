/**
 * One-time repair for the Poppins and Lato starter fonts.
 *
 * The starter library first seeded both with a variable-font weight RANGE
 * (`ital,wght@0,100..900;1,100..900`). Both families are static, so Google
 * Fonts answers that URL with a 400 and the browser loads nothing: a shop that
 * selected either one saw its storefront and admin panel stay on the fallback
 * stack — the admin on Roboto — while the picker showed the font as chosen.
 * `STARTER_FONT_EMBEDS` now lists each weight; this carries existing rows over.
 *
 * Goes through FontService.updateFont rather than writing the row directly,
 * because the stored theme holds its OWN copy of the url for each selection.
 * updateFont rewrites both copies in the same transaction, audit-logs the edit
 * and revalidates the storefront; a bare `font.update` would fix the library
 * card and leave the selected font exactly as broken.
 *
 * Only a row whose url is still byte-for-byte the broken seeded value is
 * touched. A merchant who already re-pasted a working embed keeps it.
 *
 * Safe to run repeatedly — a repaired row no longer matches.
 *
 * Run:  npx tsx scripts/backfill-static-font-urls.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { STARTER_FONT_EMBEDS } from "../src/app/module/font/font.constant";
import { FontService } from "../src/app/module/font/font.service";

/** The urls the seed originally wrote, which Google Fonts refuses. */
const BROKEN_URLS: Record<string, string> = {
    Poppins:
        "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100..900;1,100..900&display=swap",
    Lato: "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100..900;1,100..900&display=swap",
};

const replacementFor = (family: string) => {
    const embed = STARTER_FONT_EMBEDS.find((e) => e.includes(`family=${family}:`));
    if (!embed) throw new Error(`No starter embed for ${family}`);
    return embed;
};

const main = async () => {
    try {
        let repaired = 0;

        for (const [family, brokenUrl] of Object.entries(BROKEN_URLS)) {
            const rows = await prisma.font.findMany({ where: { url: brokenUrl } });

            for (const row of rows) {
                const font = await FontService.updateFont(undefined, row.id, {
                    embed: replacementFor(family),
                });
                console.log(`Repaired ${font.family}: ${font.url}`);
                repaired += 1;
            }
        }

        const setting = await prisma.storeSetting.findUnique({
            where: { id: "singleton" },
            select: { theme: true },
        });
        const theme = setting?.theme as
            | { font?: { family?: string; url?: string }; adminFont?: { family?: string; url?: string } }
            | null;

        console.log(repaired === 0 ? "Nothing to repair." : `\nRepaired ${repaired} font(s).`);
        console.log(`Storefront font: ${theme?.font?.family} — ${theme?.font?.url}`);
        console.log(`Admin font:      ${theme?.adminFont?.family} — ${theme?.adminFont?.url}`);
    } catch (error) {
        console.error("Backfill failed:", error);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
};

main();
