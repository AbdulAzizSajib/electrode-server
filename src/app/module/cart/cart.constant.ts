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

/*
 * Abandoned carts — see openspec/changes/add-abandoned-carts-admin.
 *
 * A cart is ABANDONED once it holds items and none has been added or changed
 * for this long. Measured on the ITEMS, never on `Cart.updatedAt`, which does
 * not move when items change. Fixed rather than a setting for now; the one
 * place to change it is here.
 */
export const ABANDONED_AFTER_HOURS = 24;

/*
 * The ages a purge of guest carts may choose. A closed set rather than any
 * number, so no request can purge guest carts that are minutes old. 30 days is
 * also the guest cookie's lifetime (`GUEST_TOKEN_COOKIE_OPTIONS`), past which a
 * guest cart can never be reopened by the shopper who filled it.
 */
export const GUEST_PURGE_AGE_DAYS = [7, 30, 90] as const;
export type GuestPurgeAgeDays = (typeof GUEST_PURGE_AGE_DAYS)[number];

/*
 * An empty cart must be at least this old before a purge removes it. Every
 * first-time visitor who opens the cart gets an empty one, and removing it
 * while they are about to use it would be harmless (they get a new one) but
 * pointless churn.
 */
export const EMPTY_CART_MIN_AGE_HOURS = 24;
