/**
 * `Cart` has no column to persist "which coupon is applied" (see
 * prisma/schema/Cart.prisma) and this change adds no new columns, so the
 * applied coupon code is carried the same way `guestToken` already is: a
 * plain (non-auth) cookie the client persists, read back by both
 * `GET /cart` (to preview the discount) and `POST /orders` (checkout, to
 * actually consume it) — see cart.controller.ts and order.controller.ts.
 */
export const APPLIED_COUPON_COOKIE = "appliedCoupon";

export const APPLIED_COUPON_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30 * 1000, // 30 days
};
