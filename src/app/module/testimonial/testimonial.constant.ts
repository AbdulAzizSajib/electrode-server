/**
 * The star range. Whole stars only — a testimonial is editorial copy a merchant
 * writes, not an average of anything, so there is nothing for a half star to
 * mean.
 */
export const MIN_TESTIMONIAL_RATING = 1;
export const MAX_TESTIMONIAL_RATING = 5;

/**
 * How many testimonials the storefront's homepage section renders.
 *
 * The grid is four across at its widest (`lg:grid-cols-4` in Testimonials.tsx).
 * Defined here so the API serves exactly what the section shows and the admin
 * list can mark the published entries that fall beyond it — a merchant whose
 * fifth testimonial never appears should be told why, not left to guess.
 */
export const HOME_TESTIMONIAL_COUNT = 4;

/** The cache tag the storefront drops when a testimonial changes. */
export const TESTIMONIALS_TAG = "testimonials";
