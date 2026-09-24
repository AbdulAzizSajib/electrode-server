/**
 * Bounds on a group's name.
 *
 * The name is a merchant-facing LABEL, not content: it is how a merchant with
 * three promo strips tells which Home Sections row is which. The storefront
 * never renders it. So the ceiling exists to keep the admin's list readable
 * rather than to protect anything — a 200-character "name" would break the row
 * layout on every surface that draws it.
 *
 * Mirrored by `PROMO_GROUP_NAME` in the admin's promo-banner-groups API module,
 * which carries the standing obligation every frontend limit here does: keep it
 * in step, or the panel accepts a name the server then rejects.
 */
export const MIN_PROMO_GROUP_NAME_LENGTH = 1;
export const MAX_PROMO_GROUP_NAME_LENGTH = 60;

/**
 * The placement a banner must carry to be assignable to a group.
 *
 * A group holds promo tiles and nothing else. The hero placements are owned by
 * the Home Slider manager, which has its own capacity rules per layout
 * (`hero-slots.ts` in the admin); letting a group claim one of those banners
 * would mean the same record edited from two surfaces under two different sets
 * of rules, with neither aware of the other.
 *
 * See openspec/changes/add-promo-banner-groups, design.md Decision 2.
 */
export const PROMO_GROUP_PLACEMENT = "MID" as const;
