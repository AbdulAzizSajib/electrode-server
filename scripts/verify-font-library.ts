/**
 * Verification for the font library: what may enter it, and what may not.
 *
 * Calls FontService directly rather than over HTTP, like every other verify
 * script here, and creates only `Zzverify`-prefixed rows which are removed in
 * the `finally` whether or not the assertions pass.
 *
 * The prefix is `Zzverify`, not this repo's usual `__verify_`: the parser's
 * FAMILY_PATTERN allows only letters, digits, spaces and hyphens, so an
 * underscore-prefixed family is rejected before it can be stored. Any prefix
 * used here must itself be a legal font family.
 *
 * The properties checked are the ones whose failure has a cost:
 *
 *  - all three paste forms produce the same font, so a merchant who copies the
 *    `<link>` tag instead of the `@import` rule is not told their font is
 *    invalid,
 *  - a multi-word family survives as "Open Sans" rather than "Open+Sans", which
 *    is what gets written into `font-family` and would silently not match,
 *  - a non-Google host is refused, and specifically a LOOKALIKE host is refused
 *    — `fonts.googleapis.com.evil.test` passes an `endsWith` check and fails an
 *    equality one, and this is the assertion that pins which is used,
 *  - a duplicate family is refused case-insensitively, so the picker cannot end
 *    up with two cards for one typeface, and
 *  - the stored `url` is REBUILT, never echoed: a family carrying a quote or a
 *    semicolon must not come back out in the stylesheet address.
 *
 * The parser itself is covered in depth by verify-site-settings.ts. What is new
 * here is that the library's own write path routes through it — a regression
 * that added a second, unchecked path into `Font.url` would leave that script
 * passing and this one failing.
 *
 * Run with: npx tsx scripts/verify-font-library.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { FontService } from "../src/app/module/font/font.service";

const PREFIX = "Zzverify";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Rows this run created, torn down in the finally. */
const created: string[] = [];

const add = async (embed: string) => {
    const font = await FontService.createFont(undefined, { embed });
    created.push(font.id);
    return font;
};

/** Asserts a create is refused, and returns the message the merchant would see. */
const refuses = async (label: string, embed: string, expect: string) => {
    try {
        const font = await FontService.createFont(undefined, { embed });
        created.push(font.id);
        check(label, false, `accepted and stored ${font.family}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        check(label, message.includes(expect), `refused with "${message}"`);
    }
};

const main = async () => {
    try {
        /*
         * The three paste forms. Each names a family prefixed so it cannot
         * collide with a real library entry, which also proves the parser's
         * family pattern accepts what this script needs it to.
         */
        const viaImport = await add(
            `@import url("https://fonts.googleapis.com/css2?family=${PREFIX}Import:wght@400&display=swap");`,
        );
        check(
            "an @import rule is accepted",
            viaImport.family === `${PREFIX}Import` && viaImport.url.includes("display=swap"),
            `stored ${viaImport.family}`,
        );

        const viaLink = await add(
            `<link href="https://fonts.googleapis.com/css2?family=${PREFIX}Link:wght@400&display=swap" rel="stylesheet">`,
        );
        check(
            "a <link> tag is accepted",
            viaLink.family === `${PREFIX}Link`,
            `stored ${viaLink.family}`,
        );

        const viaUrl = await add(
            `https://fonts.googleapis.com/css2?family=${PREFIX}Url:wght@400&display=swap`,
        );
        check("a bare URL is accepted", viaUrl.family === `${PREFIX}Url`, `stored ${viaUrl.family}`);

        // A multi-word family is stored readably, not URL-encoded.
        const multiWord = await add(
            `https://fonts.googleapis.com/css2?family=${PREFIX}Two+Words:wght@400&display=swap`,
        );
        check(
            "a multi-word family is stored with a space",
            multiWord.family === `${PREFIX}Two Words`,
            `stored "${multiWord.family}"`,
        );

        // display is forced regardless of what was pasted.
        const forced = await add(
            `https://fonts.googleapis.com/css2?family=${PREFIX}Swap:wght@400&display=block`,
        );
        check(
            "display is forced to swap",
            forced.url.includes("display=swap") && !forced.url.includes("display=block"),
            forced.url,
        );

        // --- Rejections ---

        await refuses(
            "a non-Google host is refused",
            `https://fonts.example.test/css2?family=${PREFIX}Evil&display=swap`,
            "fonts.googleapis.com",
        );

        /*
         * The one that matters most. This host ENDS WITH fonts.googleapis.com
         * and is not it. An `endsWith` check would accept it and load a
         * stylesheet from an attacker's domain into every page of the shop.
         */
        await refuses(
            "a lookalike host suffix is refused",
            `https://fonts.googleapis.com.evil.test/css2?family=${PREFIX}Evil&display=swap`,
            "fonts.googleapis.com",
        );

        await refuses(
            "an http:// stylesheet is refused",
            `http://fonts.googleapis.com/css2?family=${PREFIX}Insecure&display=swap`,
            "",
        );

        await refuses("text with no URL is refused", "just some words", "");

        await refuses(
            "a non-stylesheet Google path is refused",
            "https://fonts.googleapis.com/icon?family=Material+Icons",
            "",
        );

        // --- Duplicates ---

        await refuses(
            "the same family twice is refused",
            `https://fonts.googleapis.com/css2?family=${PREFIX}Import:wght@700&display=swap`,
            "already in the font library",
        );

        await refuses(
            "a duplicate differing only in case is refused",
            `https://fonts.googleapis.com/css2?family=${PREFIX}import:wght@700&display=swap`,
            "already in the font library",
        );

        // --- The URL is rebuilt, not echoed ---

        const rebuilt = await add(
            `https://fonts.googleapis.com/css2?family=${PREFIX}Rebuilt:wght@400&display=swap&evil=%22%3E%3Cscript%3E`,
        );
        check(
            "unrecognised query params are dropped from the stored URL",
            !rebuilt.url.includes("evil") && !rebuilt.url.includes("script"),
            rebuilt.url,
        );
        check(
            "the stored URL carries no quote or semicolon",
            !/["';]/.test(rebuilt.url),
            rebuilt.url,
        );

        // --- Editing ---

        const edited = await FontService.updateFont(undefined, viaImport.id, {
            embed: `https://fonts.googleapis.com/css2?family=${PREFIX}Import:wght@100..900&display=swap`,
        });
        check(
            "re-pasting the same family with new weights is allowed",
            edited.family === `${PREFIX}Import` && edited.url.includes("100..900"),
            edited.url,
        );

        let clashed = false;
        try {
            await FontService.updateFont(undefined, viaImport.id, {
                embed: `https://fonts.googleapis.com/css2?family=${PREFIX}Link:wght@400&display=swap`,
            });
        } catch {
            clashed = true;
        }
        check(
            "renaming onto another row's family is refused",
            clashed,
            "a rename may not create a duplicate",
        );

        // --- Deleting an unused font ---

        await FontService.deleteFont(undefined, viaUrl.id);
        created.splice(created.indexOf(viaUrl.id), 1);
        const gone = await prisma.font.findUnique({ where: { id: viaUrl.id } });
        check("an unused font deletes", gone === null, "row is gone");
    } finally {
        if (created.length > 0) {
            await prisma.font.deleteMany({ where: { id: { in: created } } });
        }
        // Belt and braces: anything this script named, however it got there.
        await prisma.font.deleteMany({ where: { family: { startsWith: PREFIX } } });
        await prisma.$disconnect();
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    if (failures > 0) process.exitCode = 1;
};

main();
