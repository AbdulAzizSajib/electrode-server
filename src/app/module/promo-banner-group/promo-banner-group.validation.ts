import z from "zod";
import {
    MAX_PROMO_GROUP_NAME_LENGTH,
    MIN_PROMO_GROUP_NAME_LENGTH,
} from "./promo-banner-group.constant";

/**
 * Hand-synced with the `PromoBannerLayout` enum in prisma/schema/enums.prisma —
 * update BOTH together. A value here but not in Prisma passes validation and
 * then fails at the DB with a raw error; a value in Prisma but not here is
 * rejected as a 400 despite being legal. The same obligation
 * `bannerPlacementEnum` already carries.
 */
export const promoBannerLayoutEnum = z.enum(["ONE", "TWO", "THREE"]);

const name = z
    .string()
    .trim()
    .min(MIN_PROMO_GROUP_NAME_LENGTH, "Name is required")
    .max(MAX_PROMO_GROUP_NAME_LENGTH, `Name must be at most ${MAX_PROMO_GROUP_NAME_LENGTH} characters`);

/**
 * `.trim()` before the length check, so a name of only spaces is rejected
 * rather than stored as a blank label that makes two Home Sections rows
 * indistinguishable.
 */
export const createPromoBannerGroupZodSchema = z.object({
    name,
    layout: promoBannerLayoutEnum.optional(),
    sortOrder: z.number().int().optional(),
});

/**
 * Field shapes only, all optional — an omitted key means "leave unchanged",
 * which is this repo's partial-update convention. No `.nullable()` anywhere:
 * none of these three columns has a third "cleared" state to express.
 *
 * `layout` must carry NO default here. `.partial()` does not strip a zod
 * default, so a defaulted layout would inject "THREE" into every PATCH that
 * omits it and silently reset a merchant's one-tile strip to three across.
 * The same trap `updateBannerZodSchema` documents for `type`.
 */
export const updatePromoBannerGroupZodSchema = z
    .object({
        name,
        layout: promoBannerLayoutEnum,
        sortOrder: z.number().int(),
    })
    .partial();

/**
 * The reorder payload. `.min(1)` because reordering nothing is a client bug
 * rather than a no-op worth accepting quietly — and an empty list would
 * otherwise read as a successful reorder that changed nothing.
 */
export const reorderPromoBannerGroupsZodSchema = z.object({
    ids: z.array(z.string().min(1)).min(1, "At least one group id is required"),
});
