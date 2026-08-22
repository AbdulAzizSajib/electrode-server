import z from "zod";

const couponTypeEnum = z.enum(["PERCENTAGE", "FIXED", "FREE_SHIPPING"]);
const couponStatusEnum = z.enum(["ACTIVE", "INACTIVE", "EXPIRED"]);

export const createCouponZodSchema = z.object({
    code: z.string().min(2).max(50),
    description: z.string().max(500).optional(),
    type: couponTypeEnum,
    value: z.number().nonnegative(),
    minimumOrderAmount: z.number().nonnegative().optional(),
    maximumDiscountAmount: z.number().nonnegative().optional(),
    usageLimit: z.number().int().positive().optional(),
    perCustomerLimit: z.number().int().positive().optional(),
    startsAt: z.iso.datetime().optional(),
    expiresAt: z.iso.datetime().optional(),
    status: couponStatusEnum.optional(),
    productIds: z.array(z.string()).optional(),
});

export const updateCouponZodSchema = z.object({
    code: z.string().min(2).max(50).optional(),
    description: z.string().max(500).optional(),
    type: couponTypeEnum.optional(),
    value: z.number().nonnegative().optional(),
    minimumOrderAmount: z.number().nonnegative().optional(),
    maximumDiscountAmount: z.number().nonnegative().optional(),
    usageLimit: z.number().int().positive().optional(),
    perCustomerLimit: z.number().int().positive().optional(),
    startsAt: z.iso.datetime().optional(),
    expiresAt: z.iso.datetime().optional(),
    status: couponStatusEnum.optional(),
    productIds: z.array(z.string()).optional(),
});

export const applyCouponZodSchema = z.object({
    code: z.string().min(2).max(50),
});
