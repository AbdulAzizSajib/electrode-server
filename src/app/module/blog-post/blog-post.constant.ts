/**
 * The same derivation Page uses, kept local rather than imported: the two
 * modules happen to agree today, and a change to how content pages build a slug
 * should not silently move every blog post's URL.
 */
export const slugifyTitle = (title: string): string =>
    title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

/**
 * How many posts the storefront's homepage section renders.
 *
 * The grid is four across at its widest (`lg:grid-cols-4` in BlogSection.tsx),
 * so a fifth post would either wrap onto a lonely second row or be silently
 * dropped. Defined here rather than in the storefront so the API can serve
 * exactly what the section shows and the admin can tell a merchant which of
 * their published posts fall beyond it.
 */
export const HOME_BLOG_POST_COUNT = 4;

/** The cache tag the storefront drops when a post changes. Matches the storefront's own constant. */
export const BLOG_POSTS_TAG = "blog-posts";
