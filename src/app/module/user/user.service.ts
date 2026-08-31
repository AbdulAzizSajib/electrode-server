import status from "http-status";
import { RoleName } from "../../constants/role.constant";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { IUpdateOwnProfilePayload, IUpdateUserPayload } from "./user.interface";

/** Never select `role` wholesale into a list without it — the admin staff table needs the name. */
const USER_INCLUDE = { role: { select: { id: true, name: true } } };

const getAllUsers = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.user, queryParams, {
        searchableFields: ["name", "email"],
        filterableFields: ["roleId", "status", "isActive"],
    });

    return queryBuilder
        .search()
        .filter()
        .sort()
        .paginate()
        // Soft-deleted users stay out of every listing; `where` is applied on top
        // of whatever the caller filtered by, so it cannot be overridden by a query param.
        .where({ isDeleted: false })
        .include(USER_INCLUDE)
        .execute();
};

const getUserById = async (id: string) => {
    const user = await prisma.user.findUnique({
        where: { id },
        include: USER_INCLUDE,
    });

    if (!user || user.isDeleted) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    return user;
};

const updateUser = async (
    id: string,
    payload: IUpdateUserPayload,
    requesterRole: RoleName,
) => {
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user || user.isDeleted) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    if (payload.roleId !== undefined) {
        // Assigning a role IS the privilege that /roles is OWNER-gated to protect.
        // Without this check an ADMIN could grant themselves OWNER through this
        // endpoint and bypass that restriction entirely.
        if (requesterRole !== RoleName.OWNER) {
            throw new AppError(
                status.FORBIDDEN,
                "Only an OWNER can change a user's role",
            );
        }

        const role = await prisma.role.findUnique({
            where: { id: payload.roleId },
            select: { id: true },
        });

        if (!role) {
            throw new AppError(status.BAD_REQUEST, "Role not found");
        }
    }

    return prisma.user.update({
        where: { id },
        data: payload,
        include: USER_INCLUDE,
    });
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
