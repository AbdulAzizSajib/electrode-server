/**
 * The longest embed accepted from a paste box.
 *
 * Matches the bound the `PATCH /settings` font schema already applies, so an
 * embed that endpoint's legacy paste arm would take is never refused here for
 * length alone. Generous next to a real Google Fonts snippet — a `<link>` tag
 * with a long variable-axis spec runs a few hundred characters — because the
 * parser, not this number, is what decides whether the content is acceptable.
 *
 * (The admin's Site Setting page no longer has a paste box of its own: fonts
 * are pasted here, under UI → Fonts, and merely selected there.)
 */
export const MAX_FONT_EMBED_LENGTH = 2000;

/**
 * The starter library, seeded into an empty `Font` table.
 *
 * Stored as embeds rather than as `{ family, url }` pairs so the seed is
 * subject to exactly the same parser as a merchant's paste: a typo here fails
 * at seed time instead of writing a value the API itself would have rejected.
 *
 * Ten faces chosen to cover the common storefront registers — geometric,
 * grotesque, humanist — plus Hind Siliguri, which carries Bangla script. A
 * shop serving Bangladeshi customers whose picker offered only Latin faces
 * would render its own product names in a fallback.
 *
 * These are ordinary rows once seeded: editable, deletable, with no protected
 * flag. Nothing downstream may assume a particular family is present.
 *
 * A `100..900` weight RANGE is only valid for a variable font. Poppins and Lato
 * are static — published at fixed weights only — so they must list each weight.
 * Given a range, Google Fonts answers 400 with an HTML error page; the parser
 * cannot tell (the URL is well-formed), the browser discards the stylesheet, and
 * both the storefront and the admin panel silently render their fallback stack.
 * `scripts/verify-starter-fonts.ts` fetches every entry here to catch that.
 */
export const STARTER_FONT_EMBEDS = [
    "https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap",
    "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap",
    "https://fonts.googleapis.com/css2?family=Roboto:wght@100..900&display=swap",
    "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap",
    "https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,200..1000;1,200..1000&display=swap",
    "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900&display=swap",
    "https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap",
    "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap",
    "https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap",
    "https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@300;400;500;600;700&display=swap",
] as const;
