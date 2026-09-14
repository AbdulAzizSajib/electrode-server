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
    /*
     * The chosen delivery option. Optional HERE and required in the service,
     * deliberately: a landing-page order legitimately has none, and this same
     * schema does not know which caller it is validating. The service refuses a
     * normal order without one, so the requirement is enforced exactly once, in
     * the place that can tell the two paths apart.
     *
     * There is no `deliveryMethod` beside it any more. Delivery-versus-collection
     * is a property of the option the merchant configured, so a client cannot
     * assert one against the other's price.
     */
    deliveryOptionKey: z.string().min(1).max(60).optional(),

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
 * A pre-checkout price quote.
 *
 * The option key is required, unlike everything else here: a quote whose
 * delivery charge is missing is a total the shopper would be shown and then not
 * charged. The storefront always has a key to send — the option list arrives
 * with the public settings, before any quote is asked for.
 *
 * The address is gone from this schema. It used to be here because delivery was
 * matched from it while the shopper typed; nothing about the address changes a
 * price now.
 */
export const quoteCheckoutZodSchema = z.object({
    deliveryOptionKey: z.string().min(1).max(60),
    items: z.array(checkoutItemZodSchema).min(1).max(50).optional(),
});

/**
 * A price quote for an order an operator is still typing.
 *
 * Separate from `quoteCheckoutZodSchema` above so `discountAmount` is spellable
 * on the staff route and nowhere else. The storefront's quote goes through the
 * other schema, which has no such field — a shopper who could name their own
 * discount would be a shopper who shops for free.
 *
 * `items` is required here, unlike the shopper's quote: there is no cart behind
 * a manual order to fall back to, and the customer's own cart holds what they
 * are still shopping for rather than what they just agreed to buy.
 */
export const quoteManualOrderZodSchema = z.object({
    deliveryOptionKey: z.string().min(1).max(60),
    items: z.array(checkoutItemZodSchema).min(1).max(50),
    discountAmount: z.number().nonnegative().optional(),
});

/**
 * An order an operator took over WhatsApp, Messenger, a phone call or at the
 * counter.
 *
 * Deliberately NOT `createOrderZodSchema` with extra fields. That schema
 * describes a shopper's checkout, and the two differ in what each must be
 * unable to say:
 *
 *   - no `shippingAddressId` — a staff-placed order types its address in, and
 *     honouring a stored id would let an operator ship to an address they
 *     merely guessed, exactly as it would a guest
 *   - no `couponCode` — a manual order takes a stated discount instead, and the
 *     two must never both write the order's one discount figure (design.md,
 *     Decision 5)
 *   - no per-line price — lines carry ids and a quantity, nothing else, so a
 *     price in the body is not merely ignored but unspellable (Decision 4)
 *   - no `expectedTotal` — the operator was shown the quote this endpoint
 *     re-computes
 *
 * What it requires that a checkout does not: a phone (the customer's identity),
 * an address line, a delivery option, and a channel.
 */
export const createManualOrderZodSchema = z
    .object({
        phone: z.string().refine(isValidPhone, "Please enter a valid Bangladeshi mobile number"),
        fullName: z.string().trim().min(1).max(200).optional(),
        /*
         * `addressLine1` is required here where the guest schema leaves it
         * optional. The guest schema cannot require it because a merchant may
         * have switched the field off for the storefront form; a manual order
         * bypasses that config entirely, so nothing else would ever ask.
         */
        shippingAddress: guestAddressZodSchema.extend({
            addressLine1: z.string().trim().min(1).max(255),
        }),
        items: z.array(checkoutItemZodSchema).min(1).max(50),
        deliveryOptionKey: z.string().min(1).max(60),
        channel: z.enum(["WHATSAPP", "MESSENGER", "PHONE", "IN_STORE", "OTHER"]),
        discountAmount: z.number().nonnegative().optional(),
        discountReason: z.string().trim().max(500).optional(),
        notes: z.string().max(1000).optional(),
    })
    /*
     * A discount must say why. Enforced here rather than in the service because
     * it is a property of the request alone — unlike the "discount must not
     * exceed the subtotal" rule, which needs the lines priced from the catalog
     * first and therefore lives in order.service.ts.
     *
     * `path` names the reason field so the admin form marks the control the
     * operator has to fill in, rather than the form as a whole.
     */
    .refine((body) => !(body.discountAmount && body.discountAmount > 0) || !!body.discountReason, {
        message: "Give a reason for the discount — it is what makes it auditable later",
        path: ["discountReason"],
    });

/**
 * WEBSITE is deliberately absent from `channel` above.
 *
 * It is what the column already defaults to, and it means "the customer placed
 * this themselves" — which is precisely what a staff-placed order is not. An
 * operator able to select it could file a manual order as self-service and
 * make the two populations indistinguishable in exactly the reports the field
 * exists to serve.
 *
 * LANDING_PAGE is absent from the enum itself; see `OrderChannel` in the Prisma
 * schema for why campaign attribution is not expressed there.
 */

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

/**
 * Shape only: this list must mirror the `OrderStatus` enum, but it does NOT
 * decide which transitions are legal — `ORDER_STATUS_TRANSITIONS` in
 * order.service.ts does, transactionally and against the order's current
 * state. A value accepted here can still be rejected there, which is the
 * intended split (see the validation conventions in CLAUDE.md).
 *
 * Written out rather than derived from the generated enum, matching the other
 * schemas in this file — so remember to add new statuses here too. Omitting
 * one does not fail the build; it silently 400s a status the service supports.
 */
export const updateOrderStatusZodSchema = z.object({
    status: z.enum([
        "PENDING",
        "CONFIRMED",
        "PROCESSING",
        "PACKED",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
        "COMPLETED",
    ]),
    note: z.string().max(500).optional(),
});
