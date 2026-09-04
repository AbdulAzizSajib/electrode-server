/**
 * Top-level storefront path segments a content page may NOT claim.
 *
 * Pages resolve at the storefront root (`/<slug>`), and Next.js gives a static
 * segment precedence over a dynamic one. So a page saved with slug `cart` does
 * not break the site — `/cart` keeps working — it simply never renders, and the
 * merchant gets no clue why. Rejecting the slug on write turns that silent
 * nothing into an error they can act on.
 *
 * Kept SERVER-side on purpose, and exposed at `GET /pages/reserved-slugs`: the
 * admin panel and the storefront are separate deployments, so a copy hardcoded
 * in admin would drift the first time someone adds a storefront route.
 *
 * SOURCE OF TRUTH: the directories under `frontend/src/app/`. When a top-level
 * route is added there, add it here in the same change — this list only knows
 * about routes that existed when it was written.
 */
export const RESERVED_SLUGS = [
    // Directories under frontend/src/app/
    "account",
    "api",
    "blogs",
    "cart",
    "checkout",
    "compare",
    "contact",
    "deals",
    "gift-cards",
    "products",
    "track-order",
    "wishlist",
    // Not routes, but reserved anyway: `admin` reads as the admin panel to
    // anyone typing it, and `_next` is Next.js's own asset namespace.
    "admin",
    "_next",
] as const;

const RESERVED_SLUG_SET = new Set<string>(RESERVED_SLUGS);

export const isReservedSlug = (slug: string): boolean => RESERVED_SLUG_SET.has(slug);

/**
 * Title -> slug. Lowercases, strips anything outside `[a-z0-9]`, and collapses
 * the gaps into single hyphens, which is exactly the shape `slugPattern`
 * accepts — so a derived slug never fails its own validation.
 */
export const slugifyTitle = (title: string): string =>
    title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
