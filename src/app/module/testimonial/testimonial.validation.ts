import z from "zod";
import { MAX_TESTIMONIAL_RATING, MIN_TESTIMONIAL_RATING } from "./testimonial.constant";

const ratingMessage = `Rating must be a whole number of stars from ${MIN_TESTIMONIAL_RATING} to ${MAX_TESTIMONIAL_RATING}`;

const baseTestimonialSchema = z.object({
    quote: z.string().min(1, "A quote is required").max(1000),
    authorName: z.string().min(1, "An author name is required").max(120),
    authorRole: z.string().min(1, "An author role is required").max(120),
    photoUrl: z.url("Photo URL must be valid").max(500).optional(),

    /*
     * `.int()` before the bounds, so "4.5 stars" is refused as the wrong KIND of
     * value rather than as an out-of-range one — the message a merchant needs is
     * "whole stars", not "between 1 and 5", which 4.5 already satisfies.
     */
    rating: z
        .number()
        .int(ratingMessage)
        .min(MIN_TESTIMONIAL_RATING, ratingMessage)
        .max(MAX_TESTIMONIAL_RATING, ratingMessage)
        .optional(),

    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
    sortOrder: z.number().int().min(0).optional(),
});

export const createTestimonialZodSchema = baseTestimonialSchema;

/**
 * Every field optional — a PATCH that only flips `status` or nudges
 * `sortOrder` must not have to resend the quote.
 */
export const updateTestimonialZodSchema = baseTestimonialSchema.partial();
