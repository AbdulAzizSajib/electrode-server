import z from "zod";

export const updateUserZodSchema = z.object({
    name: z.string().min(3).max(50).optional(),
    contactNumber: z.string().min(11).max(15).optional(),
    image: z.url("Image must be a valid URL").optional(),
    isActive: z.boolean().optional(),
});

/**
 * Self-service profile update — deliberately omits `isActive`. Used by
 * PATCH /auth/me so an authenticated user can update their own name,
 * contact number, and image without any path to changing activation status.
 */
export const updateOwnProfileZodSchema = z.object({
    name: z.string().min(3).max(50).optional(),
    contactNumber: z.string().min(11).max(15).optional(),
    image: z.url("Image must be a valid URL").optional(),
});
