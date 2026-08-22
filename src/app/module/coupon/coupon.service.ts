import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { CouponStatus, CouponType, OrderStatus } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { CustomerService } from "../customer/customer.service";
import {
    ICartItemForDiscount,
    ICouponDiscountResult,
    ICouponForValidation,
    ICreateCouponPayload,
    IUpdateCouponPayload,
} from "./coupon.interface";

const COUPON_INCLUDE = {
    products: { include: { product: { select: { id: true, name: true, slug: true } } } },
};

const CART_WITH_ITEMS_INCLUDE = {
    items: { include: { product: true, variant: true } },
};

/** Cancelled orders don't consume a customer's coupon redemption. */
const NON_CONSUMING_ORDER_STATUSES: OrderStatus[] = [OrderStatus.CANCELLED];

const normalizeCode = (code: string) => code.trim().toUpperCase();

const ensureUniqueCode = async (code: string, excludeId?: string) => {
    const existing = await prisma.coupon.findFirst({
        where: { code, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, `Coupon code "${code}" is already in use`);
    }
};

const createCoupon = async (payload: ICreateCouponPayload) => {
    const code = normalizeCode(payload.code);
    await ensureUniqueCode(code);

    const { productIds, startsAt, expiresAt, ...rest } = payload;

    return prisma.coupon.create({
        data: {
            ...rest,
            code,
            startsAt: startsAt ? new Date(startsAt) : undefined,
            expiresAt: expiresAt ? new Date(expiresAt) : undefined,
            ...(productIds && productIds.length > 0
                ? { products: { create: productIds.map((productId) => ({ productId })) } }
                : {}),
        },
        include: COUPON_INCLUDE,
    });
};

const getAdminCoupons = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.coupon, queryParams, {
        searchableFields: ["code", "description"],
        filterableFields: ["status", "type"],
    });

    return queryBuilder.search().filter().sort().paginate().include(COUPON_INCLUDE).execute();
};

const getCouponOrThrow = async (id: string) => {
    const coupon = await prisma.coupon.findUnique({ where: { id }, include: COUPON_INCLUDE });

    if (!coupon) {
        throw new AppError(status.NOT_FOUND, "Coupon not found");
    }

    return coupon;
};

const updateCoupon = async (id: string, payload: IUpdateCouponPayload) => {
    const existing = await getCouponOrThrow(id);

    let code = existing.code;
    if (payload.code) {
        code = normalizeCode(payload.code);
        if (code !== existing.code) {
            await ensureUniqueCode(code, id);
        }
    }

    const { productIds, startsAt, expiresAt, ...rest } = payload;

    return prisma.$transaction(async (tx) => {
        await tx.coupon.update({
            where: { id },
            data: {
                ...rest,
                code,
                startsAt: startsAt ? new Date(startsAt) : undefined,
                expiresAt: expiresAt ? new Date(expiresAt) : undefined,
            },
        });

        if (productIds) {
            await tx.couponProduct.deleteMany({ where: { couponId: id } });
            if (productIds.length > 0) {
                await tx.couponProduct.createMany({
                    data: productIds.map((productId) => ({ couponId: id, productId })),
                });
            }
        }

        return tx.coupon.findUniqueOrThrow({ where: { id }, include: COUPON_INCLUDE });
    });
};

const deleteCoupon = async (id: string) => {
    await getCouponOrThrow(id);

    return prisma.coupon.delete({ where: { id } });
};

// ---- Cart/checkout-facing ----

/** Finds the requester's existing cart (never creates one) — used before a coupon can be applied/validated. */
const resolveExistingCart = async (userId: string | undefined, guestTokenCookie: string | undefined) => {
    if (userId) {
        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        const cart = await prisma.cart.findUnique({
            where: { customerId: customer.id },
            include: CART_WITH_ITEMS_INCLUDE,
        });
        return { cart, customerId: customer.id };
    }

    if (guestTokenCookie) {
        const cart = await prisma.cart.findUnique({
            where: { guestToken: guestTokenCookie },
            include: CART_WITH_ITEMS_INCLUDE,
        });
        return { cart, customerId: undefined };
    }

    return { cart: null, customerId: undefined };
};

const computeCartSubtotal = (items: ICartItemForDiscount[]) =>
    items.reduce((sum, item) => {
        const unitPrice = Number(item.variant?.price ?? item.product.price);
        return sum + unitPrice * item.quantity;
    }, 0);

/**
 * Validates a coupon against a cart per `api/marketing` spec — status,
 * date window, usageLimit vs usageCount, perCustomerLimit, minimumOrderAmount,
 * and (if `CouponProduct` rows exist) product eligibility — before any
 * discount is calculated. Throws a specific, user-facing reason on the
 * first failing rule; returns the computed discount otherwise.
 *
 * `perCustomerLimit` is checked against `Order.couponCode` usage for
 * `customerId` — the only place a coupon redemption is recorded (see
 * order.service.ts's `placeOrder`). It can't be checked for guests (no
 * `customerId`), so it is skipped for guest carts.
 */
const validateCouponForCart = async (
    coupon: ICouponForValidation,
    items: ICartItemForDiscount[],
    customerId?: string,
): Promise<ICouponDiscountResult> => {
    const now = new Date();

    if (items.length === 0) {
        throw new AppError(status.BAD_REQUEST, "Your cart is empty");
    }

    if (coupon.status !== CouponStatus.ACTIVE) {
        throw new AppError(status.BAD_REQUEST, "This coupon is not active");
    }
    if (coupon.startsAt && coupon.startsAt > now) {
        throw new AppError(status.BAD_REQUEST, "This coupon is not active yet");
    }
    if (coupon.expiresAt && coupon.expiresAt < now) {
        throw new AppError(status.BAD_REQUEST, "This coupon has expired");
    }
    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
        throw new AppError(status.BAD_REQUEST, "This coupon has reached its usage limit");
    }

    if (coupon.perCustomerLimit !== null && customerId) {
        const usedByCustomer = await prisma.order.count({
            where: {
                customerId,
                couponCode: coupon.code,
                status: { notIn: NON_CONSUMING_ORDER_STATUSES },
            },
        });
        if (usedByCustomer >= coupon.perCustomerLimit) {
            throw new AppError(
                status.BAD_REQUEST,
                "You have already used this coupon the maximum number of times",
            );
        }
    }

    const subtotal = computeCartSubtotal(items);

    if (coupon.minimumOrderAmount !== null && subtotal < Number(coupon.minimumOrderAmount)) {
        throw new AppError(
            status.BAD_REQUEST,
            `This coupon requires a minimum order amount of ${Number(coupon.minimumOrderAmount)}`,
        );
    }

    if (coupon.products.length > 0) {
        const eligibleProductIds = new Set(coupon.products.map((p) => p.productId));
        const hasEligibleItem = items.some((item) => eligibleProductIds.has(item.productId));
        if (!hasEligibleItem) {
            throw new AppError(
                status.BAD_REQUEST,
                "This coupon is not applicable to any product currently in your cart",
            );
        }
    }

    if (coupon.type === CouponType.FREE_SHIPPING) {
        return { discountAmount: 0, freeShipping: true, subtotal };
    }

    let discountAmount =
        coupon.type === CouponType.PERCENTAGE
            ? (subtotal * Number(coupon.value)) / 100
            : Number(coupon.value);

    if (coupon.maximumDiscountAmount !== null) {
        discountAmount = Math.min(discountAmount, Number(coupon.maximumDiscountAmount));
    }
    discountAmount = Math.min(discountAmount, subtotal);

    return { discountAmount, freeShipping: false, subtotal };
};

const getActiveCouponByCode = async (code: string) => {
    const coupon = await prisma.coupon.findUnique({
        where: { code: normalizeCode(code) },
        include: COUPON_INCLUDE,
    });

    if (!coupon) {
        throw new AppError(status.NOT_FOUND, "Coupon not found");
    }

    return coupon;
};

const applyCouponToCart = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    code: string,
) => {
    const { cart, customerId } = await resolveExistingCart(userId, guestTokenCookie);

    if (!cart || cart.items.length === 0) {
        throw new AppError(status.BAD_REQUEST, "Your cart is empty");
    }

    const coupon = await getActiveCouponByCode(code);
    const result = await validateCouponForCart(coupon, cart.items, customerId);

    return { cart, coupon, ...result };
};

/**
 * Re-validates a previously-applied coupon (its code, read from the
 * client's `appliedCoupon` cookie — see coupon.constant.ts) against the
 * current cart, for `GET /cart`'s live discount preview. Returns `null`
 * instead of throwing on any invalid/no-longer-applicable state (expired
 * mid-session, cart no longer meets minimumOrderAmount, etc.) so a stale
 * cookie never breaks a plain cart fetch — the caller clears the cookie
 * when this returns `null`.
 */
const getAppliedDiscountForCart = async (
    items: ICartItemForDiscount[],
    customerId: string | undefined,
    appliedCouponCode: string | undefined,
) => {
    if (!appliedCouponCode || items.length === 0) {
        return null;
    }

    const coupon = await prisma.coupon.findUnique({
        where: { code: normalizeCode(appliedCouponCode) },
        include: COUPON_INCLUDE,
    });
    if (!coupon) {
        return null;
    }

    try {
        const result = await validateCouponForCart(coupon, items, customerId);
        return { coupon, ...result };
    } catch {
        return null;
    }
};

export const CouponService = {
    createCoupon,
    getAdminCoupons,
    getCouponOrThrow,
    updateCoupon,
    deleteCoupon,
    applyCouponToCart,
    getActiveCouponByCode,
    validateCouponForCart,
    getAppliedDiscountForCart,
    computeCartSubtotal,
};
