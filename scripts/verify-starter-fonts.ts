/**
 * Every starter font's stylesheet actually loads from Google Fonts.
 *
 * The parser checks that an embed is a well-formed fonts.googleapis.com
 * stylesheet URL, and it cannot check more than that offline. A URL can pass it
 * and still be one Google refuses: a `wght@100..900` range on a STATIC family
 * (Poppins, Lato) is answered with a 400 and an HTML error page. The browser
 * discards that as a stylesheet, so the storefront and the admin panel both sit
 * on their fallback stack with nothing in the console a merchant would ever see
 * — which shipped once, in the seed, for exactly those two families.
 *
 * Needs the network, not the database. Covers STARTER_FONT_EMBEDS only; a row a
 * merchant pasted came from Google's own embed builder, which never emits a
 * range for a family that has no variable axis.
 *
 * Run with: npx tsx scripts/verify-starter-fonts.ts
 */
import { STARTER_FONT_EMBEDS } from "../src/app/module/font/font.constant";
import { parseGoogleFontEmbed } from "../src/app/module/store-setting/google-font";

/*
 * Google Fonts varies the CSS it returns by user agent, and answers a UA it
 * does not recognise with a fallback format. A current desktop Chrome UA gets
 * the response a real visitor would.
 */
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const main = async () => {
    for (const embed of STARTER_FONT_EMBEDS) {
        const parsed = parseGoogleFontEmbed(embed);

        if (!parsed.ok) {
            check(embed, false, `does not parse: ${parsed.message}`);
            continue;
        }

        const { family, url } = parsed.value;

        try {
            const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
            const type = res.headers.get("content-type") ?? "";
            const body = await res.text();

            check(
                family,
                res.ok && type.startsWith("text/css") && body.includes("@font-face"),
                `${res.status} ${type || "(no content-type)"}`,
            );
        } catch (error) {
            check(family, false, `request failed: ${(error as Error).message}`);
        }
    }

    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    if (failures > 0) process.exitCode = 1;
};

main();
