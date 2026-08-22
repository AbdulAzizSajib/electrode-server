import { CouponStatus, CouponType } from "../../../generated/prisma/client";

export interface ICreateCouponPayload {
    code: string;
    description?: string;
    type: "PERCENTAGE" | "FIXED" | "FREE_SHIPPING";
    value: number;
    minimumOrderAmount?: number;
    maximumDiscountAmount?: number;
    usageLimit?: number;
    perCustomerLimit?: number;
    startsAt?: string;
    expiresAt?: string;
    status?: "ACTIVE" | "INACTIVE" | "EXPIRED";
    /** Product ids this coupon is scoped to (CouponProduct); omitted/empty = valid for any product. */
    productIds?: string[];
}

export type IUpdateCouponPayload = Partial<ICreateCouponPayload>;

export interface IApplyCouponPayload {
    code: string;
}

/** Minimal shape `CouponService`'s validation logic needs from a cart line item — deliberately loose on the Decimal-typed price fields (see coupon.service.ts). */
export interface ICartItemForDiscount {
    productId: string;
    quantity: number;
    product: { price: unknown };
    variant: { price: unknown } | null;
}

/** Minimal shape `CouponService`'s validation logic needs from a Coupon (+ its CouponProduct scoping). */
export interface ICouponForValidation {
    id: string;
    code: string;
    type: CouponType;
    value: unknown;
    minimumOrderAmount: unknown;
    maximumDiscountAmount: unknown;
    usageLimit: number | null;
    usageCount: number;
    perCustomerLimit: number | null;
    startsAt: Date | null;
    expiresAt: Date | null;
    status: CouponStatus;
    products: { productId: string }[];
}

export interface ICouponDiscountResult {
    discountAmount: number;
    freeShipping: boolean;
    subtotal: number;
}
