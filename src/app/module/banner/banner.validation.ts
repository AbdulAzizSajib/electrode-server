import z from "zod";

const bannerStatusEnum = z.enum(["DRAFT", "ACTIVE", "INACTIVE", "SCHEDULED"]);

export const createBannerZodSchema = z.object({
    title: z.string().min(2).max(200),
    subtitle: z.string().max(300).optional(),
    image: z.url("Image must be a valid URL"),
    mobileImage: z.url("Mobile image must be a valid URL").optional(),
    link: z.url("Link must be a valid URL").optional(),
    status: bannerStatusEnum.optional(),
    sortOrder: z.number().int().optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
});

export const updateBannerZodSchema = z.object({
    title: z.string().min(2).max(200).optional(),
    subtitle: z.string().max(300).optional(),
    image: z.url("Image must be a valid URL").optional(),
    mobileImage: z.url("Mobile image must be a valid URL").optional(),
    link: z.url("Link must be a valid URL").optional(),
    status: bannerStatusEnum.optional(),
    sortOrder: z.number().int().optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
});
