import crypto from "crypto";
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { ProductStatus } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CampaignService } from "../campaign/campaign.service";
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
                    offerPrice: true,
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
 * The same resolution as `resolveCart`, minus the `CART_INCLUDE` payload.
 * Mutations only ever need `cart.id` — they call `reloadCart` afterwards for
 * the full cart anyway — so fetching every item, product, image and variant
 * up front is work that gets thrown away on every add/update/remove.
 */
const resolveCartId = async (userId: string | undefined, guestTokenCookie: string | undefined) => {
    if (userId) {
        const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
        const cart = await prisma.cart.upsert({
            where: { customerId: customer.id },
            create: { customerId: customer.id },
            update: {},
            select: { id: true },
        });
        return { cartId: cart.id, customerId: customer.id };
    }

    if (guestTokenCookie) {
        const existing = await prisma.cart.findUnique({
            where: { guestToken: guestTokenCookie },
            select: { id: true },
        });
        if (existing) {
            return { cartId: existing.id, customerId: undefined };
        }
    }

    const guestToken = generateGuestToken();
    const cart = await prisma.cart.create({
        data: { guestToken },
        select: { id: true },
    });
    return { cartId: cart.id, customerId: undefined, newGuestToken: guestToken };
};

/**
 * Attaches each line's `effectiveUnitPrice` — what that unit will actually be
 * charged, once any active campaign is applied.
 *
 * The cart deliberately returns no other monetary field: the storefront
 * derives every total from the catalogue prices on each row. That worked only
 * while the price a shopper is charged WAS `offerPrice`. Campaign pricing
 * broke it — the cart page, the drawer and the pre-quote checkout summary all
 * multiplied out `offerPrice` and showed a subtotal the order then undercut.
 *
 * So the effective price is resolved here, server side, rather than teaching
 * each of those surfaces about campaigns: they all read one field, and the
 * charged figure comes from `CampaignService` either way, so the cart cannot
 * drift from checkout without the two disagreeing about the same call.
 *
 * `offerPrice` is left on the row untouched — it is the struck-through
 * comparison the cart shows next to a discounted line.
 */
const withEffectivePrices = async <
    T extends {
        productId: string;
        variantId: string | null;
        product: { offerPrice: unknown };
        variant: { offerPrice: unknown } | null;
    },
>(
    items: T[],
) => {
    const campaignPriceByKey = await CampaignService.getActiveDiscountsForLines(
        items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            unitPrice: Number(item.variant?.offerPrice ?? item.product.offerPrice),
        })),
    );

    return items.map((item) => {
        const listPrice = Number(item.variant?.offerPrice ?? item.product.offerPrice);
        const campaignPrice = campaignPriceByKey.get(`${item.productId}:${item.variantId ?? ""}`);

        return {
            ...item,
            effectiveUnitPrice: campaignPrice ?? listPrice,
            /** Null unless a campaign is cutting this line's price. */
            campaignUnitPrice: campaignPrice ?? null,
        };
    });
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

    const [items, discount] = await Promise.all([
        withEffectivePrices(cart.items),
        CouponService.getAppliedDiscountForCart(cart.items, customerId, appliedCouponCode),
    ]);

    return { cart: { ...cart, items }, newGuestToken, discount };
};

/**
 * The post-mutation cart, shaped exactly like `getCart`'s — items *and* the
 * re-validated `discount`. Clients render a cart straight from a mutation
 * response rather than following it with a read, so anything `getCart`
 * returns has to be here too; omitting `discount` would silently drop an
 * applied coupon from the UI until the next full fetch.
 *
 * The one thing this deliberately does not do is `getCart`'s cookie
 * clearing when a coupon has stopped applying — a mutation has no business
 * mutating the coupon cookie. The next cart read reconciles it.
 */
const reloadCart = async (
    cartId: string,
    customerId: string | undefined,
    appliedCouponCode?: string,
) => {
    const cart = await prisma.cart.findUniqueOrThrow({
        where: { id: cartId },
        include: CART_INCLUDE,
    });

    const [items, discount] = await Promise.all([
        withEffectivePrices(cart.items),
        CouponService.getAppliedDiscountForCart(cart.items, customerId, appliedCouponCode),
    ]);

    return { ...cart, items, discount };
};

const addItem = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    payload: IAddCartItemPayload,
    appliedCouponCode?: string,
) => {
    // Independent of each other: which cart this is has no bearing on whether
    // the product exists, so they resolve concurrently rather than in series.
    const [{ cartId, customerId, newGuestToken }, product, variant] = await Promise.all([
        resolveCartId(userId, guestTokenCookie),
        prisma.product.findUnique({ where: { id: payload.productId } }),
        payload.variantId
            ? prisma.productVariant.findUnique({ where: { id: payload.variantId } })
            : Promise.resolve(null),
    ]);

    if (!product || product.status !== ProductStatus.ACTIVE) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    if (payload.variantId && (!variant || variant.productId !== payload.productId)) {
        throw new AppError(status.BAD_REQUEST, "Variant does not belong to this product");
    }

    const quantityToAdd = payload.quantity ?? 1;

    // find-or-increment: an explicit lookup, not a blind insert relying on
    // the DB unique constraint — Postgres treats NULL as distinct in unique
    // indexes, so two rows with the same cartId+productId and variantId
    // NULL would NOT collide there (see CartItem.prisma).
    const existingItem = await prisma.cartItem.findFirst({
        where: {
            cartId,
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
                cartId,
                productId: payload.productId,
                variantId: payload.variantId,
                quantity: quantityToAdd,
            },
        });
    }

    return { cart: await reloadCart(cartId, customerId, appliedCouponCode), newGuestToken };
};

const updateItemQuantity = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    itemId: string,
    quantity: number,
    appliedCouponCode?: string,
) => {
    const [{ cartId, customerId, newGuestToken }, item] = await Promise.all([
        resolveCartId(userId, guestTokenCookie),
        prisma.cartItem.findUnique({ where: { id: itemId } }),
    ]);

    if (!item || item.cartId !== cartId) {
        throw new AppError(status.NOT_FOUND, "Cart item not found");
    }

    await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });

    return { cart: await reloadCart(cartId, customerId, appliedCouponCode), newGuestToken };
};

const removeItem = async (
    userId: string | undefined,
    guestTokenCookie: string | undefined,
    itemId: string,
    appliedCouponCode?: string,
) => {
    const [{ cartId, customerId, newGuestToken }, item] = await Promise.all([
        resolveCartId(userId, guestTokenCookie),
        prisma.cartItem.findUnique({ where: { id: itemId } }),
    ]);

    if (!item || item.cartId !== cartId) {
        throw new AppError(status.NOT_FOUND, "Cart item not found");
    }

    await prisma.cartItem.delete({ where: { id: itemId } });

    return { cart: await reloadCart(cartId, customerId, appliedCouponCode), newGuestToken };
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
