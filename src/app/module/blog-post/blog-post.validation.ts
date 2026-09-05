import z from "zod";

/**
 * Lowercase words joined by single hyphens — the same rule Page uses, and the
 * shape `slugifyTitle` produces, so an auto-derived slug always passes.
 *
 * Deliberately NOT refined against RESERVED_SLUGS. Those guard the storefront
 * ROOT, where a page's slug competes with real routes like `/cart`; a post
 * lives at `/blogs/<slug>`, a namespace of its own, so a post called "cart" is
 * simply `/blogs/cart` and collides with nothing.
 */
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slugSchema = z
    .string()
    .min(1)
    .max(200)
    .regex(slugPattern, "Slug must be lowercase words separated by single hyphens");

/**
 * Mirrors Page's body rule: `<p></p>` is what the editor emits for an empty
 * document and is rejected the same way a bare "" is, so a post cannot be
 * published as a blank screen.
 */
const bodySchema = z
    .string()
    .min(1, "Post body cannot be empty")
    .max(200_000)
    .refine((html) => html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() !== "", {
        message: "Post body cannot be empty",
    });

const mediaTypeEnum = z.enum(["NONE", "IMAGE", "VIDEO"]);

const baseBlogPostSchema = z.object({
    title: z.string().min(1).max(200),
    // Optional: omitted means "derive it from the title" (blog-post.service.ts).
    slug: slugSchema.optional(),
    excerpt: z.string().min(1, "An excerpt is required").max(500),
    body: bodySchema,

    mediaType: mediaTypeEnum.optional(),
    imageUrl: z.url("Image URL must be valid").max(500).optional(),
    videoUrl: z.url("Video URL must be valid").max(500).optional(),
    videoThumbnailUrl: z.url("Video thumbnail URL must be valid").max(500).optional(),

    publishedAt: z.iso.datetime({ offset: true }).optional(),

    metaTitle: z.string().max(200).optional(),
    metaDescription: z.string().max(500).optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

/**
 * Ties the URL columns to `mediaType`.
 *
 * This is the invariant Postgres cannot express, and it is the one that makes
 * "a post carries either an image or a video, never both" true of the DATA
 * rather than merely of the form that usually writes it. Without it a row can
 * hold both URLs and nothing defines which the storefront should show.
 *
 * Applied to CREATE, where `mediaType` is known, and re-applied on UPDATE only
 * when the update actually mentions media — see the note on the update schema.
 */
const assertMediaConsistent = (
    value: {
        mediaType?: z.infer<typeof mediaTypeEnum>;
        imageUrl?: string;
        videoUrl?: string;
        videoThumbnailUrl?: string;
    },
    ctx: z.RefinementCtx,
) => {
    const type = value.mediaType ?? "NONE";

    if (type === "IMAGE") {
        if (!value.imageUrl) {
            ctx.addIssue({
                code: "custom",
                path: ["imageUrl"],
                message: "An image post needs an image",
            });
        }
        for (const key of ["videoUrl", "videoThumbnailUrl"] as const) {
            if (value[key]) {
                ctx.addIssue({
                    code: "custom",
                    path: [key],
                    message: "An image post cannot also carry a video — choose one",
                });
            }
        }
        return;
    }

    if (type === "VIDEO") {
        if (!value.videoUrl) {
            ctx.addIssue({
                code: "custom",
                path: ["videoUrl"],
                message: "A video post needs a video",
            });
        }
        if (value.imageUrl) {
            ctx.addIssue({
                code: "custom",
                path: ["imageUrl"],
                message: "A video post cannot also carry an image — choose one",
            });
        }
        return;
    }

    // NONE
    for (const key of ["imageUrl", "videoUrl", "videoThumbnailUrl"] as const) {
        if (value[key]) {
            ctx.addIssue({
                code: "custom",
                path: [key],
                message: "Set the media type before attaching media",
            });
        }
    }
};

export const createBlogPostZodSchema = baseBlogPostSchema.superRefine(assertMediaConsistent);

/**
 * Every field optional — a PATCH that only flips `status` must not have to
 * resend the body.
 *
 * The media invariant is re-checked only when the payload MENTIONS media. A
 * PATCH carrying just `{ status }` says nothing about the post's media and must
 * not be judged as though it had declared `mediaType: NONE`; a PATCH that does
 * touch any of the four is a complete statement about the media and is checked
 * in full. That is why the media fields move as a set from the admin form.
 */
export const updateBlogPostZodSchema = baseBlogPostSchema
    .partial()
    .superRefine((value, ctx) => {
        const mentionsMedia =
            value.mediaType !== undefined ||
            value.imageUrl !== undefined ||
            value.videoUrl !== undefined ||
            value.videoThumbnailUrl !== undefined;

        if (!mentionsMedia) return;

        if (value.mediaType === undefined) {
            ctx.addIssue({
                code: "custom",
                path: ["mediaType"],
                message: "Send the media type alongside any media change",
            });
            return;
        }

        assertMediaConsistent(value, ctx);
    });
