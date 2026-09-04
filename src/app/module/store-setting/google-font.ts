/**
 * Parses the embed code Google Fonts hands a merchant into the two values the
 * storefront actually needs: a family name and a stylesheet URL.
 *
 * This is a security boundary, not a convenience parser. Both outputs are
 * interpolated into every page the storefront serves — the family into a
 * `font-family` declaration inside an inline `style` attribute on `<html>`, the
 * URL into a `<link href>` — so neither may contain anything the merchant typed
 * that has not been checked against an allow-list.
 *
 * Two rules make that true:
 *
 *  1. The host is compared with `===`, never `endsWith`. `endsWith` would
 *     accept `fonts.googleapis.com.evil.test`, which is a different origin
 *     entirely.
 *  2. The returned URL is REBUILT from validated components rather than sliced
 *     out of the input. No substring of the paste survives into the stored
 *     value, so there is nothing for a crafted paste to smuggle through.
 *
 * The accepted input forms are the three things a merchant plausibly copies:
 * a CSS `@import`, an HTML `<link>` tag, or the bare URL. Because a bare URL is
 * one of them, a previously stored URL re-parses to itself — which is what lets
 * the admin form round-trip an unchanged font through the same validation as a
 * fresh paste, rather than needing a second, unvalidated "keep what's there"
 * path into the column.
 */

/** The only host a font stylesheet may come from. Compared by equality. */
const GOOGLE_FONTS_HOST = "fonts.googleapis.com";

/** `/css2` is current; `/css` is the older endpoint and still widely pasted. */
const ALLOWED_PATHS = new Set(["/css2", "/css"]);

/**
 * Family names as Google spells them: letters, digits, spaces and hyphens.
 * Deliberately strict — this value ends up inside a quoted `font-family`, so
 * a quote, semicolon or backslash getting through would break out of the
 * declaration.
 */
const FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/;

/**
 * The axis/weight spec after the family, e.g. `wght@100..900` or
 * `ital,wght@0,300..800;1,300..800`. Restricted to the punctuation Google's own
 * format uses; notably excludes quotes, whitespace and angle brackets.
 */
const AXIS_PATTERN = /^[A-Za-z0-9,;.@+-]{1,200}$/;

/** First absolute http(s) URL in the text, however it is wrapped. */
const URL_PATTERN = /https?:\/\/[^\s"'()<>]+/i;

export interface GoogleFont {
    /** Human-readable, spaces intact — e.g. `Open Sans`. */
    family: string;
    /** Rebuilt from validated parts. Never a slice of the input. */
    url: string;
}

export type ParseGoogleFontResult =
    | { ok: true; value: GoogleFont }
    | { ok: false; message: string };

const fail = (message: string): ParseGoogleFontResult => ({ ok: false, message });

/**
 * Extracts `{ family, url }` from a Google Fonts embed.
 *
 * The first URL in the text is the one validated, rather than scanning for a
 * Google-looking one: if a merchant pastes something pointing elsewhere, the
 * right answer is to tell them the host is wrong, not to skip past it and use
 * a different URL further down the same paste.
 */
export function parseGoogleFontEmbed(input: string): ParseGoogleFontResult {
    const text = (input ?? "").trim();
    if (!text) return fail("Paste the embed code from Google Fonts.");

    const match = text.match(URL_PATTERN);
    if (!match) {
        return fail(
            "That does not look like a Google Fonts embed. Paste the @import rule, the <link> tag, or the stylesheet URL.",
        );
    }

    let parsed: URL;
    try {
        parsed = new URL(match[0]);
    } catch {
        return fail("The stylesheet address in that embed is not a valid URL.");
    }

    // https only — an http stylesheet on an https storefront is blocked by the
    // browser as mixed content anyway, so accepting it would store a font that
    // silently never loads.
    if (parsed.protocol !== "https:") {
        return fail("The font stylesheet must be served over https.");
    }

    if (parsed.hostname !== GOOGLE_FONTS_HOST) {
        return fail(`Only ${GOOGLE_FONTS_HOST} stylesheets are accepted.`);
    }

    if (!ALLOWED_PATHS.has(parsed.pathname)) {
        return fail("That Google Fonts URL is not a stylesheet address.");
    }

    // `URLSearchParams` decodes `+` to a space, so `Open+Sans:wght@400` arrives
    // as `Open Sans:wght@400` and the family needs no separate decoding step.
    const familyParam = parsed.searchParams.get("family");
    if (!familyParam) {
        return fail("That Google Fonts URL does not name a font family.");
    }

    const separator = familyParam.indexOf(":");
    const family = (separator === -1 ? familyParam : familyParam.slice(0, separator)).trim();
    const axis = separator === -1 ? "" : familyParam.slice(separator + 1).trim();

    if (!FAMILY_PATTERN.test(family)) {
        return fail(`"${family}" is not a usable font family name.`);
    }
    if (axis && !AXIS_PATTERN.test(axis)) {
        return fail("The weight/style part of that font URL is not in a format we recognise.");
    }

    /*
     * Rebuilt, not sliced. Every piece below is either a literal or a value
     * that has just been matched against a pattern above, so the result cannot
     * carry anything the merchant typed but we did not check.
     *
     * Assembled by hand rather than with URLSearchParams because that would
     * percent-encode the `:`, `@` and `;` that Google's own canonical format
     * uses unescaped. `display=swap` is forced: it is what keeps text visible
     * in the fallback face while the webfont loads, rather than invisible.
     */
    const encodedFamily = family.replace(/ /g, "+") + (axis ? `:${axis}` : "");
    const url = `https://${GOOGLE_FONTS_HOST}${parsed.pathname}?family=${encodedFamily}&display=swap`;

    return { ok: true, value: { family, url } };
}
