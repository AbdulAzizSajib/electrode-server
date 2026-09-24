import z from "zod";

const bannerStatusEnum = z.enum(["DRAFT", "ACTIVE", "INACTIVE", "SCHEDULED"]);
export const bannerTypeEnum = z.enum(["IMAGE", "DYNAMIC"]);
/**
 * Hand-synced with the `BannerPlacement` enum in prisma/schema/enums.prisma —
 * update BOTH together. A value present here but not in Prisma passes
 * validation and then fails at the DB with a raw error; a value present in
 * Prisma but not here is rejected as a 400 despite being legal.
 *
 * HERO_SLIDER / HERO_SIDE / HERO_PROMO address the homepage hero's three
 * differently-shaped slots.
 */
export const bannerPlacementEnum = z.enum([
    "HEADER",
    "MID",
    "FOOTER",
    "SIDEBAR",
    "POPUP",
    "HERO_SLIDER",
    "HERO_SIDE",
    "HERO_PROMO",
]);

const hexColor = z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex color, e.g. #FF5733");

/**
 * Fields that only a DYNAMIC banner renders. An IMAGE banner carrying any of
 * them is rejected rather than silently storing content nothing will draw.
 */
const DYNAMIC_ONLY_FIELDS = [
    "title",
    "subtitle",
    "description",
    "price",
    "discountPrice",
    "buttonText",
    "bgColor",
    "textColor",
] as const;

const bannerFields = {
    type: bannerTypeEnum,
    placement: bannerPlacementEnum,

    // Required for IMAGE via the superRefine below, not at the field level —
    // the per-type contract lives in one place.
    image: z.url("Image must be a valid URL").optional(),
    mobileImage: z.url("Mobile image must be a valid URL").optional(),

    title: z.string().min(2).max(200).optional(),
    subtitle: z.string().max(300).optional(),
    description: z.string().max(2000).optional(),
    price: z.number().nonnegative().optional(),
    discountPrice: z.number().nonnegative().optional(),
    buttonText: z.string().min(1).max(100).optional(),
    bgColor: hexColor.optional(),
    textColor: hexColor.optional(),

    link: z.url("Link must be a valid URL").optional(),
    productId: z.string().optional(),

    /**
     * The promo strip this banner is a tile of.
     *
     * `.nullable().optional()` rather than `.optional()` alone, and that is the
     * repo's three-state rule rather than a habit: omitted means "leave the
     * membership unchanged", and NULL IS THE ONLY WAY TO REMOVE A BANNER FROM
     * ITS GROUP without deleting the banner. Without the nullable, a merchant
     * who assigned a tile to the wrong strip could only move it to another one,
     * never take it out — the same reasoning `freeShippingThreshold` and
     * `activeLandingPageId` carry.
     *
     * Whether the banner's placement ALLOWS a group is checked in
     * banner.service.ts, not here: the rule depends on the stored `placement`
     * for a PATCH that does not mention it, and a Zod schema cannot read the
     * database.
     */
    promoBannerGroupId: z.string().nullable().optional(),

    status: bannerStatusEnum.optional(),
    sortOrder: z.number().int().optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
};

/**
 * Enforces the per-type field contract shared by create (on the raw body) and
 * update (in banner.service.ts, against the payload merged over the stored
 * row — a PATCH body alone can't be judged, since `type` may be unchanged).
 */
export const checkBannerTypeContract = (
    banner: {
        type?: "IMAGE" | "DYNAMIC";
        image?: string | null;
        title?: string | null;
        [key: string]: unknown;
    },
    report: (path: string, message: string) => void,
) => {
    if (banner.type === "DYNAMIC") {
        if (!banner.title) {
            report("title", "title is required for a DYNAMIC banner");
        }
        return;
    }

    if (!banner.image) {
        report("image", "image is required for an IMAGE banner");
    }

    for (const field of DYNAMIC_ONLY_FIELDS) {
        if (banner[field] !== undefined && banner[field] !== null) {
            report(field, `${field} is only allowed on a DYNAMIC banner`);
        }
    }
};

/**
 * The DYNAMIC-only content an IMAGE banner still carries from an earlier life,
 * as a `{ field: null }` patch — for an update to clear on its way past.
 *
 * Without this, `updateBanner`'s merged contract check judged stored values the
 * request never mentioned, so a row carrying any of them could never be saved
 * again: the admin hides those inputs on an IMAGE banner, leaving no way to
 * clear what it was refusing. It also made switching a banner from DYNAMIC to
 * IMAGE impossible for the same reason. Clearing is the only reading that can
 * be right — the fields belong to a type this banner no longer is, and nothing
 * renders them. A value the request *sends* is still rejected, which is the
 * contract the spec states.
 */
export const staleDynamicFields = (banner: {
    type?: "IMAGE" | "DYNAMIC";
    [key: string]: unknown;
}, payload: Record<string, unknown>) => {
    if (banner.type !== "IMAGE") return {};

    const clears: Record<string, null> = {};

    for (const field of DYNAMIC_ONLY_FIELDS) {
        if (!(field in payload) && banner[field] !== undefined && banner[field] !== null) {
            clears[field] = null;
        }
    }

    return clears;
};

/**
 * A flat object plus `.superRefine`, not a discriminated union: `validateRequest`
 * is typed `(zodSchema: z.ZodObject)` and a union is not a ZodObject. superRefine
 * preserves ZodObject assignability, so the shared middleware stays untouched.
 */
export const createBannerZodSchema = z
    .object({ ...bannerFields, type: bannerTypeEnum.default("IMAGE") })
    .superRefine((value, ctx) => {
        checkBannerTypeContract(value, (path, message) => {
            ctx.addIssue({ code: "custom", message, path: [path] });
        });
    });

/**
 * Field shapes only. The type contract is re-checked in banner.service.ts
 * against the payload merged over the stored banner.
 *
 * `type` must carry no default here: `.partial()` does NOT strip a zod default,
 * so a defaulted `type` would inject "IMAGE" into every PATCH that omits it and
 * silently override the stored type during the merge.
 */
export const updateBannerZodSchema = z.object(bannerFields).partial();

export const publicBannerQueryZodSchema = z.object({
    placement: bannerPlacementEnum.optional(),
});
