import z from "zod";
import { isValidPhone } from "../../utils/phone";

/**
 * Inline shipping address for a guest, who has none saved to reference.
 *
 * Every field is optional, `addressLine1` and `city` included. Which of them a
 * guest must supply is now a merchant setting (see `checkoutConfig` on
 * StoreSetting), and `validateRequest` cannot read settings — it only ever
 * parses `req.body`. Requiring them here would reject an order the merchant
 * deliberately configured to be placeable without them, before order.service.ts
 * ever got to apply the real rule. This schema keeps its actual job: whatever IS
 * present must be well-formed.
 */
const guestAddressZodSchema = z.object({
    addressLine1: z.string().max(255).optional(),
    addressLine2: z.string().max(255).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
});

const checkoutItemZodSchema = z.object({
    productId: z.string().min(1),
    variantId: z.string().min(1).optional(),
    quantity: z.number().int().positive().max(100),
});

/**
 * Shape-level validation only. Whether the *guest* fields are required
 * depends on the session, which `validateRequest` cannot see — it runs before
 * the actor is resolved and only ever parses `req.body`. The guest/authenticated
 * distinction is therefore enforced in order.service.ts, where the actor is
 * known; this schema's job is to guarantee that whatever IS present is
 * well-formed.
 */
export const createOrderZodSchema = z.object({
    shippingAddressId: z.string().optional(),
    notes: z.string().max(1000).optional(),
    expectedTotal: z.number().nonnegative().optional(),
    // Absent means delivery. Whether collection is actually available depends on
    // the matched shipping places, which only the service can see.
    deliveryMethod: z.enum(["DELIVERY", "PICKUP"]).optional(),

    fullName: z.string().trim().min(1).max(200).optional(),
    phone: z
        .string()
        .refine(isValidPhone, "Please enter a valid Bangladeshi mobile number")
        .optional(),
    shippingAddress: guestAddressZodSchema.optional(),
    items: z.array(checkoutItemZodSchema).min(1).max(50).optional(),
    // Guests are COD-only (enforced in the service). Accepting the full enum
    // here would let an authenticated flow pass a method this endpoint does
    // not yet act on, so only COD is spellable.
    paymentMethod: z.literal("COD").optional(),
});

/**
 * A pre-checkout price quote. Everything is optional: it is asked for while the
 * shopper is still typing their address, and a partial destination is a real
 * question ("what does it cost to Bangladesh?") rather than a malformed one.
 */
export const quoteCheckoutZodSchema = z.object({
    shippingAddressId: z.string().optional(),
    country: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    items: z.array(checkoutItemZodSchema).min(1).max(50).optional(),
});

/**
 * The `Idempotency-Key` header, not a body field — so `validateRequest`
 * (which only ever parses `req.body`) can't reach it; order.controller.ts
 * applies this schema itself.
 *
 * Optional by design: a request without a key is a valid checkout that
 * simply forgoes replay protection, which is what lets an older storefront
 * keep working against a newer server. A key that IS sent must be a UUID —
 * a malformed one is rejected rather than silently stored, since a client
 * sending garbage here isn't getting the protection it thinks it is.
 */
export const idempotencyKeyZodSchema = z.uuid().optional();

/**
 * Guest order tracking. A guest has no session to authorize a read, so the
 * order number alone must not be enough — it is guessable and would expose
 * one customer's order to anyone. Requiring the phone the order was placed
 * with makes the pair the credential.
 */
export const guestOrderLookupZodSchema = z.object({
    orderNumber: z.string().min(1).max(64),
    phone: z.string().refine(isValidPhone, "Please enter a valid Bangladeshi mobile number"),
});

export const updateOrderStatusZodSchema = z.object({
    status: z.enum([
        "PENDING",
        "CONFIRMED",
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
        "COMPLETED",
    ]),
    note: z.string().max(500).optional(),
});
