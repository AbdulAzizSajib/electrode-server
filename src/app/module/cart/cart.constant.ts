/**
 * Identifies a not-logged-in shopper's cart. Minted by cart.service.ts on a
 * guest's first cart action and stored in a plain (non-auth) cookie —
 * unrelated to the better-auth session token.
 *
 * Shared rather than module-private because guest checkout reads the very
 * same cookie to find the cart it is about to turn into an order (see
 * order.controller.ts). If the two ever named different cookies, checkout
 * would silently resolve an empty cart and every guest would be told their
 * cart is empty at the final step.
 */
export const GUEST_TOKEN_COOKIE = "guestToken";

export const GUEST_TOKEN_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30 * 1000, // 30 days
};
