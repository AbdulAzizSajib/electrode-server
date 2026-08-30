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
