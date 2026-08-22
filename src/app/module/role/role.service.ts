import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { Prisma } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import {
    IAssignPermissionPayload,
    ICreatePermissionPayload,
    ICreateRolePayload,
    IUpdatePermissionPayload,
    IUpdateRolePayload,
} from "./role.interface";

const ROLE_INCLUDE = { permissions: { include: { permission: true } } };

// ---- Role ----

const createRole = async (payload: ICreateRolePayload) => {
    return prisma.role.create({ data: payload });
};

const getRoles = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.role, queryParams, {
        searchableFields: ["name", "description"],
    });

    return queryBuilder.search().sort().paginate().include(ROLE_INCLUDE).execute();
};

const getRoleOrThrow = async (id: string) => {
    const role = await prisma.role.findUnique({ where: { id }, include: ROLE_INCLUDE });

    if (!role) {
        throw new AppError(status.NOT_FOUND, "Role not found");
    }

    return role;
};

const updateRole = async (id: string, payload: IUpdateRolePayload) => {
    await getRoleOrThrow(id);

    return prisma.role.update({ where: { id }, data: payload, include: ROLE_INCLUDE });
};

const deleteRole = async (id: string) => {
    await getRoleOrThrow(id);

    try {
        return await prisma.role.delete({ where: { id } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
            throw new AppError(status.CONFLICT, "Cannot delete a role that still has users assigned to it");
        }
        throw error;
    }
};

// ---- Permission ----

const createPermission = async (payload: ICreatePermissionPayload) => {
    return prisma.permission.create({ data: payload });
};

const getPermissions = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.permission, queryParams, {
        searchableFields: ["name", "description"],
    });

    return queryBuilder.search().sort().paginate().execute();
};

const getPermissionOrThrow = async (id: string) => {
    const permission = await prisma.permission.findUnique({ where: { id } });

    if (!permission) {
        throw new AppError(status.NOT_FOUND, "Permission not found");
    }

    return permission;
};

const updatePermission = async (id: string, payload: IUpdatePermissionPayload) => {
    await getPermissionOrThrow(id);

    return prisma.permission.update({ where: { id }, data: payload });
};

const deletePermission = async (id: string) => {
    await getPermissionOrThrow(id);

    try {
        return await prisma.permission.delete({ where: { id } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
            throw new AppError(
                status.CONFLICT,
                "Cannot delete a permission that is still assigned to a role",
            );
        }
        throw error;
    }
};

// ---- RolePermission ----

/**
 * NOTE: `checkAuth` gates routes by comparing a user's `Role.name` against a
 * fixed `RoleName` string (see constants/role.constant.ts) — it does not
 * consult `RolePermission` at all. This CRUD manages the RBAC data model for
 * a future finer-grained permission check; it does not itself change what
 * any route currently allows.
 */
const assignPermissionToRole = async (roleId: string, payload: IAssignPermissionPayload) => {
    await getRoleOrThrow(roleId);
    await getPermissionOrThrow(payload.permissionId);

    const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId, permissionId: payload.permissionId } },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, "This role already has this permission");
    }

    await prisma.rolePermission.create({ data: { roleId, permissionId: payload.permissionId } });

    return getRoleOrThrow(roleId);
};

const revokePermissionFromRole = async (roleId: string, permissionId: string) => {
    const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId, permissionId } },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "This role does not have this permission");
    }

    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId } } });

    return getRoleOrThrow(roleId);
};

export const RoleService = {
    createRole,
    getRoles,
    getRoleOrThrow,
    updateRole,
    deleteRole,
    createPermission,
    getPermissions,
    getPermissionOrThrow,
    updatePermission,
    deletePermission,
    assignPermissionToRole,
    revokePermissionFromRole,
};
