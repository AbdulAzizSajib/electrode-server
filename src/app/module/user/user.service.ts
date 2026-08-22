import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { IUpdateOwnProfilePayload, IUpdateUserPayload } from "./user.interface";

const getAllUsers = async () => {
    return prisma.user.findMany({
        where: { isDeleted: false },
        orderBy: { createdAt: "desc" },
    });
};

const getUserById = async (id: string) => {
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user || user.isDeleted) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    return user;
};

const updateUser = async (id: string, payload: IUpdateUserPayload) => {
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user || user.isDeleted) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    return prisma.user.update({ where: { id }, data: payload });
};

const updateOwnProfile = async (
    userId: string,
    payload: IUpdateOwnProfilePayload,
) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user || user.isDeleted) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    if (payload.contactNumber) {
        const existing = await prisma.user.findFirst({
            where: {
                contactNumber: payload.contactNumber,
                id: { not: userId },
            },
            select: { id: true },
        });

        if (existing) {
            throw new AppError(
                status.CONFLICT,
                "This contact number is already in use",
            );
        }
    }

    return prisma.user.update({ where: { id: userId }, data: payload });
};

const softDeleteUser = async (id: string, requesterId: string) => {
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user || user.isDeleted) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    if (user.id === requesterId) {
        throw new AppError(status.BAD_REQUEST, "You cannot delete yourself");
    }

    return prisma.user.update({
        where: { id },
        data: {
            isDeleted: true,
            isActive: false,
            deletedAt: new Date(),
        },
    });
};

export const UserService = {
    getAllUsers,
    getUserById,
    updateUser,
    updateOwnProfile,
    softDeleteUser,
};
