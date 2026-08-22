import crypto from "crypto";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { ProductStatus } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CouponService } from "../coupon/coupon.service";
import { CustomerService } from "../customer/customer.service";
import { IAddCartItemPayload } from "./cart.interface";

const CART_INCLUDE = {
    items: {
        include: {
            product: {
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    price: true,
                    status: true,
                    images: { where: { isPrimary: true }, take: 1 },
                },
            },
            variant: true,
        },
        orderBy: { createdAt: "asc" as const },
    },
};

const generateGuestToken = () => crypto.randomBytes(24).toString("hex");

/**
 * Resolves the cart for this request: the customer's cart when logged in
 * (get-or-create, lazily creating the Customer row too if this is their
 * first storefront action), otherwise the guest cart identified by
 * `guestTokenCookie` — minting a fresh guest cart+token if neither a
 * session nor a valid guest cookie is present. Per `api/cart-wishlist`
 * spec, a cart operation without a session falls back to guest behavior
 * instead of failing.
 */
const resolveCart = async (userId: string | undefined, guestTokenCookie: string | undefined) => {
    if (userId) {
        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        const cart = await prisma.cart.upsert({
            where: { customerId: customer.id },
            create: { customerId: customer.id },
            update: {},
            include: CART_INCLUDE,
        });
        return { cart, customerId: customer.id };
    }

    if (guestTokenCookie) {
        const existing = await prisma.cart.findUnique({
            where: { guestToken: guestTokenCookie },
            include: CART_INCLUDE,
        });
        if (existing) {
            return { cart: existing, customerId: undefined };
        }
    }

    const guestToken = generateGuestToken();
    const cart = await prisma.cart.create({
        data: { guestToken },
        include: CART_INCLUDE,
    });
    return { cart, newGuestToken: guestToken, customerId: undefined };
};

/**
 * `appliedCouponCode` (read from the `appliedCoupon` cookie by
 * cart.controller.ts) is re-validated against the current cart on every
 * fetch so the discount preview never shows a stale/no-longer-applicable
 * coupon — see `CouponService.getAppliedDiscountForCart`. `discount` is
 * `null` when no coupon is applied or it's no longer valid; the controller
 * clears the cookie in the latter case.
 */
const getCart = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    appliedCouponCode?: string,
) => {
    const { cart, newGuestToken, customerId } = await resolveCart(userId, guestTokenCookie);

    const discount = await CouponService.getAppliedDiscountForCart(
        cart.items,
        customerId,
        appliedCouponCode,
    );

    return { cart, newGuestToken, discount };
};

const reloadCart = (cartId: string) =>
    prisma.cart.findUniqueOrThrow({ where: { id: cartId }, include: CART_INCLUDE });

const addItem = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    payload: IAddCartItemPayload,
) => {
    const { cart, newGuestToken } = await resolveCart(userId, guestTokenCookie);

    const product = await prisma.product.findUnique({ where: { id: payload.productId } });
    if (!product || product.status !== ProductStatus.ACTIVE) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    if (payload.variantId) {
        const variant = await prisma.productVariant.findUnique({
            where: { id: payload.variantId },
        });
        if (!variant || variant.productId !== payload.productId) {
            throw new AppError(status.BAD_REQUEST, "Variant does not belong to this product");
        }
    }

    const quantityToAdd = payload.quantity ?? 1;

    // find-or-increment: an explicit lookup, not a blind insert relying on
    // the DB unique constraint — Postgres treats NULL as distinct in unique
    // indexes, so two rows with the same cartId+productId and variantId
    // NULL would NOT collide there (see CartItem.prisma).
    const existingItem = await prisma.cartItem.findFirst({
        where: {
            cartId: cart.id,
            productId: payload.productId,
            variantId: payload.variantId ?? null,
        },
    });

    if (existingItem) {
        await prisma.cartItem.update({
            where: { id: existingItem.id },
            data: { quantity: existingItem.quantity + quantityToAdd },
        });
    } else {
        await prisma.cartItem.create({
            data: {
                cartId: cart.id,
                productId: payload.productId,
                variantId: payload.variantId,
                quantity: quantityToAdd,
            },
        });
    }

    return { cart: await reloadCart(cart.id), newGuestToken };
};

const updateItemQuantity = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    itemId: string,
    quantity: number,
) => {
    const { cart, newGuestToken } = await resolveCart(userId, guestTokenCookie);

    const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cart.id) {
        throw new AppError(status.NOT_FOUND, "Cart item not found");
    }

    await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });

    return { cart: await reloadCart(cart.id), newGuestToken };
};

const removeItem = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    itemId: string,
) => {
    const { cart, newGuestToken } = await resolveCart(userId, guestTokenCookie);

    const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cart.id) {
        throw new AppError(status.NOT_FOUND, "Cart item not found");
    }

    await prisma.cartItem.delete({ where: { id: itemId } });

    return { cart: await reloadCart(cart.id), newGuestToken };
};

/**
 * Merges a guest cart into the customer's cart on login (per
 * `api/cart-wishlist` spec: quantities combine on matching product/variant,
 * and the guest cart stops being reachable by its former token). No-op if
 * the guest token doesn't resolve to a cart (e.g. already merged/expired).
 */
const mergeGuestCartIntoCustomerCart = async (customerId: string, guestToken: string) => {
    const guestCart = await prisma.cart.findUnique({
        where: { guestToken },
        include: { items: true },
    });

    if (!guestCart) {
        return;
    }

    if (guestCart.items.length === 0) {
        await prisma.cart.delete({ where: { id: guestCart.id } });
        return;
    }

    const customerCart = await prisma.cart.upsert({
        where: { customerId },
        create: { customerId },
        update: {},
    });

    await prisma.$transaction(async (tx) => {
        for (const guestItem of guestCart.items) {
            const existing = await tx.cartItem.findFirst({
                where: {
                    cartId: customerCart.id,
                    productId: guestItem.productId,
                    variantId: guestItem.variantId ?? null,
                },
            });

            if (existing) {
                await tx.cartItem.update({
                    where: { id: existing.id },
                    data: { quantity: existing.quantity + guestItem.quantity },
                });
            } else {
                await tx.cartItem.create({
                    data: {
                        cartId: customerCart.id,
                        productId: guestItem.productId,
                        variantId: guestItem.variantId,
                        quantity: guestItem.quantity,
                    },
                });
            }
        }

        // Cascades the guest cart's CartItems (Cart -> CartItem onDelete:
        // Cascade) and frees the guestToken so it stops resolving to a cart.
        await tx.cart.delete({ where: { id: guestCart.id } });
    });
};

export const CartService = {
    getCart,
    addItem,
    updateItemQuantity,
    removeItem,
    mergeGuestCartIntoCustomerCart,
};
