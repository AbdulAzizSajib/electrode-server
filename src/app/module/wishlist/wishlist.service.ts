import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { CustomerService } from "../customer/customer.service";

const WISHLIST_INCLUDE = {
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
        },
        orderBy: { createdAt: "desc" as const },
    },
};

const getOrCreateWishlist = async (customerId: string) => {
    return prisma.wishlist.upsert({
        where: { customerId },
        create: { customerId },
        update: {},
        include: WISHLIST_INCLUDE,
    });
};

const getMyWishlist = async (userId: string) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
    return getOrCreateWishlist(customer.id);
};

const addItem = async (userId: string, productId: string) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
    const wishlist = await getOrCreateWishlist(customer.id);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
        throw new AppError(status.NOT_FOUND, "Product not found");
    }

    const existing = await prisma.wishlistItem.findUnique({
        where: { wishlistId_productId: { wishlistId: wishlist.id, productId } },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, "Product is already in your wishlist");
    }

    await prisma.wishlistItem.create({ data: { wishlistId: wishlist.id, productId } });

    return prisma.wishlist.findUniqueOrThrow({
        where: { id: wishlist.id },
        include: WISHLIST_INCLUDE,
    });
};

const removeItem = async (userId: string, itemId: string) => {
    const customer = await CustomerService.getOrCreateCustomerByUserId(userId);
    const wishlist = await getOrCreateWishlist(customer.id);

    const item = await prisma.wishlistItem.findUnique({ where: { id: itemId } });
    if (!item || item.wishlistId !== wishlist.id) {
        throw new AppError(status.NOT_FOUND, "Wishlist item not found");
    }

    await prisma.wishlistItem.delete({ where: { id: itemId } });

    return prisma.wishlist.findUniqueOrThrow({
        where: { id: wishlist.id },
        include: WISHLIST_INCLUDE,
    });
};

export const WishlistService = {
    getMyWishlist,
    addItem,
    removeItem,
};
