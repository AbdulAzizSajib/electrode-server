import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AddressType } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { ICreateAddressPayload, IUpdateAddressPayload } from "./customer.interface";

/**
 * `User` (auth identity, has a Role) and `Customer` (storefront profile that
 * Cart/Wishlist/Order/CustomerAddress all hang off) are separate models —
 * registration only creates a `User`. This resolves the `Customer` row for
 * an authenticated user's session, creating it on first storefront use
 * (lazily, not at registration, so OWNER/ADMIN/STAFF users never get one
 * unless they actually shop).
 */
const getOrCreateCustomerByUserId = async (userId: string) => {
    const existing = await prisma.customer.findUnique({ where: { userId } });
    if (existing) {
        return existing;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    const [firstName, ...rest] = user.name.trim().split(/\s+/);

    return prisma.customer.create({
        data: {
            userId: user.id,
            firstName: firstName || user.name,
            lastName: rest.length > 0 ? rest.join(" ") : undefined,
            email: user.email,
            phone: user.contactNumber ?? undefined,
        },
    });
};

const getMyAddresses = async (customerId: string) => {
    return prisma.customerAddress.findMany({
        where: { customerId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
};

const getMyAddressById = async (customerId: string, addressId: string) => {
    const address = await prisma.customerAddress.findUnique({ where: { id: addressId } });

    if (!address || address.customerId !== customerId) {
        throw new AppError(status.NOT_FOUND, "Address not found");
    }

    return address;
};

/** Unsets any other address of the same customer+type currently marked default. */
const clearDefaultForType = async (
    customerId: string,
    type: AddressType,
    excludeId?: string,
) => {
    await prisma.customerAddress.updateMany({
        where: {
            customerId,
            type,
            isDefault: true,
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        data: { isDefault: false },
    });
};

const createAddress = async (customerId: string, payload: ICreateAddressPayload) => {
    const type = payload.type ?? AddressType.SHIPPING;

    if (payload.isDefault) {
        await clearDefaultForType(customerId, type);
    }

    return prisma.customerAddress.create({
        data: { ...payload, type, customerId },
    });
};

const updateAddress = async (
    customerId: string,
    addressId: string,
    payload: IUpdateAddressPayload,
) => {
    const existing = await getMyAddressById(customerId, addressId);

    if (payload.isDefault) {
        await clearDefaultForType(customerId, payload.type ?? existing.type, addressId);
    }

    return prisma.customerAddress.update({
        where: { id: addressId },
        data: payload,
    });
};

const setDefaultAddress = async (customerId: string, addressId: string) => {
    const existing = await getMyAddressById(customerId, addressId);

    await clearDefaultForType(customerId, existing.type, addressId);

    return prisma.customerAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
    });
};

const deleteAddress = async (customerId: string, addressId: string) => {
    await getMyAddressById(customerId, addressId);

    return prisma.customerAddress.delete({ where: { id: addressId } });
};

export const CustomerService = {
    getOrCreateCustomerByUserId,
    getMyAddresses,
    getMyAddressById,
    createAddress,
    updateAddress,
    setDefaultAddress,
    deleteAddress,
};
