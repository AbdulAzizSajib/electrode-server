import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { Prisma, ProductStatus } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { CartService } from "../cart/cart.service";
import { CustomerService } from "../customer/customer.service";

const WISHLIST_ITEM_INCLUDE = {
    product: {
        select: {
            id: true,
            name: true,
            slug: true,
            price: true,
            status: true,
            averageRating: true,
            reviewCount: true,
            images: { where: { isPrimary: true }, take: 1 },
        },
    },
};

/**
 * A wishlist must never advertise something a shopper cannot buy, so every read
 * path filters to ACTIVE products — matching the public catalog's rule. Applied
 * identically by the listing and the count so the header badge and the page can
 * never disagree.
 */
const ACTIVE_ITEM_WHERE = { product: { status: ProductStatus.ACTIVE } };

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const getOrCreateWishlist = async (customerId: string) => {
    return prisma.wishlist.upsert({
        where: { customerId },
        create: { customerId },
        update: {},
    });
};

/** Resolves the caller's wishlist in one step — used by every operation below. */
const resolveWishlist = async (userId: string) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
    return getOrCreateWishlist(customer.id);
};

const getMyWishlist = async (userId: string, page = DEFAULT_PAGE, limit = DEFAULT_LIMIT) => {
    const wishlist = await resolveWishlist(userId);

    const currentPage = Math.max(Number(page) || DEFAULT_PAGE, 1);
    const take = Math.max(Number(limit) || DEFAULT_LIMIT, 1);
    const skip = (currentPage - 1) * take;

    const where = { wishlistId: wishlist.id, ...ACTIVE_ITEM_WHERE };

    const [items, total] = await Promise.all([
        prisma.wishlistItem.findMany({
            where,
            include: WISHLIST_ITEM_INCLUDE,
            orderBy: { createdAt: "desc" },
            skip,
            take,
        }),
        prisma.wishlistItem.count({ where }),
    ]);

    return {
        data: { id: wishlist.id, customerId: wishlist.customerId, items },
        meta: {
            page: currentPage,
            limit: take,
            total,
            totalPages: Math.ceil(total / take),
        },
    };
};

const getWishlistCount = async (userId: string) => {
    const wishlist = await resolveWishlist(userId);

    const count = await prisma.wishlistItem.count({
        where: { wishlistId: wishlist.id, ...ACTIVE_ITEM_WHERE },
    });

    return { count };
};

/**
 * Lets a product card render its heart state without fetching the whole
 * wishlist. Always 200 — "not saved" is an answer, not a missing resource.
 */
const containsProduct = async (userId: string, productId: string) => {
    const wishlist = await resolveWishlist(userId);

    const item = await prisma.wishlistItem.findUnique({
        where: { wishlistId_productId: { wishlistId: wishlist.id, productId } },
        select: { id: true },
    });

    return { inWishlist: !!item, itemId: item?.id ?? null };
};

const addItem = async (userId: string, productId: string) => {
    const wishlist = await resolveWishlist(userId);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    // Let the DB's @@unique([wishlistId, productId]) arbitrate rather than a
    // check-then-create: two concurrent adds would both pass a prior existence
    // check and the second would surface as a raw P2002 instead of a 409.
    try {
        await prisma.wishlistItem.create({ data: { wishlistId: wishlist.id, productId } });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            throw new AppError(status.CONFLICT, "Product is already in your wishlist");
        }
        throw error;
    }

    return getMyWishlist(userId);
};

const removeItem = async (userId: string, itemId: string) => {
    const wishlist = await resolveWishlist(userId);

    const item = await prisma.wishlistItem.findUnique({ where: { id: itemId } });
    if (!item || item.wishlistId !== wishlist.id) {
        throw new AppError(status.NOT_FOUND, "Wishlist item not found");
    }

    await prisma.wishlistItem.delete({ where: { id: itemId } });

    return getMyWishlist(userId);
};

/** Remove by product, so a product card's heart toggle needs no id lookup first. */
const removeItemByProduct = async (userId: string, productId: string) => {
    const wishlist = await resolveWishlist(userId);

    const item = await prisma.wishlistItem.findUnique({
        where: { wishlistId_productId: { wishlistId: wishlist.id, productId } },
    });

    if (!item) {
        throw new AppError(status.NOT_FOUND, "Product is not in your wishlist");
    }

    await prisma.wishlistItem.delete({ where: { id: item.id } });

    return getMyWishlist(userId);
};

/**
 * Moves a saved product into the cart.
 *
 * Ordered add-then-delete rather than a single transaction: CartService.addItem
 * binds the module-level prisma client and cannot enlist in an external
 * $transaction (see design.md Decision 8). Ordering it this way makes the only
 * reachable failure mode the safe one — if the cart add throws, the wishlist
 * entry is untouched, which is what the spec requires. The residual risk is a
 * crash between the two steps leaving the item in both places: user-visible as
 * a stale wishlist row, and self-correcting on the next remove.
 */
const moveItemToCart = async (userId: string, itemId: string, appliedCouponCode?: string) => {
    const wishlist = await resolveWishlist(userId);

    const item = await prisma.wishlistItem.findUnique({ where: { id: itemId } });
    if (!item || item.wishlistId !== wishlist.id) {
        throw new AppError(status.NOT_FOUND, "Wishlist item not found");
    }

    // Throws (404 on an inactive/missing product) before anything is deleted.
    const { cart } = await CartService.addItem(
        userId,
        undefined,
        { productId: item.productId, quantity: 1 },
        appliedCouponCode,
    );

    await prisma.wishlistItem.delete({ where: { id: itemId } });

    return cart;
};

export const WishlistService = {
    getMyWishlist,
    getWishlistCount,
    containsProduct,
    addItem,
    removeItem,
    removeItemByProduct,
    moveItemToCart,
};
