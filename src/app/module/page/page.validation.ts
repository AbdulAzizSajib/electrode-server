import z from "zod";
import { isReservedSlug } from "./page.constant";

/**
 * Lowercase words joined by single hyphens — no leading, trailing or doubled
 * hyphen, no uppercase, no spaces. This is both a URL-safety rule and the shape
 * `slugifyTitle` produces, so an auto-derived slug always passes.
 */
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slugSchema = z
    .string()
    .min(1)
    .max(200)
    .regex(slugPattern, "Slug must be lowercase words separated by single hyphens")
    // Refined rather than folded into the regex so the merchant gets the real
    // reason ("that segment belongs to the storefront") instead of a generic
    // format complaint. See page.constant.ts.
    .refine((slug) => !isReservedSlug(slug), {
        message: "This slug is reserved by the storefront — pick a different one",
    });

/**
 * A page with an empty body is a published blank screen, so the body is
 * required on create. `<p></p>` is what the editor emits for an empty document
 * and is rejected the same way a bare "" is — see the storefront's
 * `isBlankHtml`, which this deliberately mirrors on the write side.
 */
const bodySchema = z
    .string()
    .min(1, "Page body cannot be empty")
    .max(200_000)
    .refine((html) => html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() !== "", {
        message: "Page body cannot be empty",
    });

export const createPageZodSchema = z.object({
    title: z.string().min(1).max(200),
    // Optional: omitted means "derive it from the title" (page.service.ts).
    slug: slugSchema.optional(),
    body: bodySchema,
    metaTitle: z.string().max(200).optional(),
    metaDescription: z.string().max(500).optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
    sortOrder: z.number().int().min(0).optional(),
});

/**
 * Every field optional — a PATCH that only flips `status` must not have to
 * resend the body. `.partial()` over the create schema rather than a hand-typed
 * duplicate, so the two cannot drift.
 */
export const updatePageZodSchema = createPageZodSchema.partial();
