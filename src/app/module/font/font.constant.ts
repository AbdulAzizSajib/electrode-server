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
 */
export const STARTER_FONT_EMBEDS = [
    "https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap",
    "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap",
    "https://fonts.googleapis.com/css2?family=Roboto:wght@100..900&display=swap",
    "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100..900;1,100..900&display=swap",
    "https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,200..1000;1,200..1000&display=swap",
    "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100..900;1,100..900&display=swap",
    "https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap",
    "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap",
    "https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap",
    "https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@300;400;500;600;700&display=swap",
] as const;
