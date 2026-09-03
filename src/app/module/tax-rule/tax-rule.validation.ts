import z from "zod";

export const createTaxRuleZodSchema = z.object({
    name: z.string().min(1, "A tax rule needs a name").max(100),
    type: z.enum(["FLAT", "PERCENT"]).optional(),
    // Non-negative: a negative tax is a discount, which belongs to coupons and
    // campaigns rather than here.
    value: z.number().nonnegative("A tax cannot be negative"),
});

export const updateTaxRuleZodSchema = createTaxRuleZodSchema.partial();
