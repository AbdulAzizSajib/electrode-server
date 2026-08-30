import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AddressType, Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { normalizePhone } from "../../utils/phone";
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

    // Normalized like every other write to this column (see utils/phone.ts):
    // storing the raw `contactNumber` would sidestep the phone merge and, worse,
    // violate the unique constraint outright if a guest already holds the
    // normalized form of the same number — failing this user's first checkout.
    const normalizedPhone = user.contactNumber ? normalizePhone(user.contactNumber) : null;

    // A phone already held by a guest-created customer belongs to that row; the
    // unique constraint permits only one holder. Leave this customer's phone
    // unset rather than failing account creation — the two records are merged
    // by whatever identity work follows, not by crashing here.
    const phoneIsTaken = normalizedPhone
        ? (await prisma.customer.count({ where: { phone: normalizedPhone } })) > 0
        : false;

    return prisma.customer.create({
        data: {
            userId: user.id,
            firstName: firstName || user.name,
            lastName: rest.length > 0 ? rest.join(" ") : undefined,
            email: user.email,
            phone: !phoneIsTaken && normalizedPhone ? normalizedPhone : undefined,
        },
    });
};

/**
 * Resolves the `Customer` for a guest checkout, keyed on phone number — the
 * de facto customer identity in this market, and already collected for COD
 * delivery, so it costs the buyer no extra step.
 *
 * The phone is normalized to E.164 before both the lookup and the insert:
 * `01712345678` and `+8801712345678` are one person, and matching on the raw
 * string would hand them a fresh customer record on every visit, fragmenting
 * the order history that makes repeat-buyer tracking possible at all.
 *
 * A customer created here has no `userId` — `Customer.userId` is nullable
 * precisely so a storefront profile can exist without an auth identity.
 *
 * Note that an existing record is returned as-is: a guest whose phone matches
 * a registered customer attaches their order to that customer, but gains no
 * session, no saved addresses, and no visibility of past orders. Phone is an
 * unverified claim, so attaching (harmless, and preserves the merge) is
 * permitted while reading (a disclosure) stays gated. See design.md.
 */
const getOrCreateCustomerByPhone = async (phone: string, fullName: string) => {
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
        throw new AppError(status.BAD_REQUEST, "Please enter a valid Bangladeshi mobile number");
    }

    const existing = await prisma.customer.findUnique({ where: { phone: normalizedPhone } });
    if (existing) {
        return existing;
    }

    // Split the same way getOrCreateCustomerByUserId splits `user.name`, so a
    // customer's name is shaped identically however their record came about.
    const [firstName, ...rest] = fullName.trim().split(/\s+/);

    if (!firstName) {
        throw new AppError(status.BAD_REQUEST, "Full name is required");
    }

    try {
        return await prisma.customer.create({
            data: {
                firstName,
                lastName: rest.length > 0 ? rest.join(" ") : undefined,
                phone: normalizedPhone,
            },
        });
    } catch (error) {
        // Two checkouts for the same new phone can race between the findUnique
        // above and this insert; the unique constraint arbitrates and the loser
        // reads back the winner's row rather than failing the order.
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            return prisma.customer.findUniqueOrThrow({ where: { phone: normalizedPhone } });
        }
        throw error;
    }
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
    getOrCreateCustomerByPhone,
    getMyAddresses,
    getMyAddressById,
    createAddress,
    updateAddress,
    setDefaultAddress,
    deleteAddress,
};
