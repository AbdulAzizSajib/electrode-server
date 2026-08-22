import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, Prisma } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { ICreateWarehousePayload, IUpdateWarehousePayload } from "./warehouse.interface";

const ensureUniqueCode = async (code: string, excludeId?: string) => {
    const existing = await prisma.warehouse.findFirst({
        where: { code, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, `Warehouse code "${code}" is already in use`);
    }
};

const createWarehouse = async (userId: string, payload: ICreateWarehousePayload) => {
    await ensureUniqueCode(payload.code);

    const warehouse = await prisma.warehouse.create({ data: payload });

    await AuditLogService.record(userId, AuditAction.CREATE, "Warehouse", warehouse.id, {
        newData: warehouse,
    });

    return warehouse;
};

const getWarehouses = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.warehouse, queryParams, {
        searchableFields: ["name", "code", "city"],
        filterableFields: ["isActive", "country"],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

const getWarehouseById = async (id: string) => {
    const warehouse = await prisma.warehouse.findUnique({ where: { id } });

    if (!warehouse) {
        throw new AppError(status.NOT_FOUND, "Warehouse not found");
    }

    return warehouse;
};

const updateWarehouse = async (userId: string, id: string, payload: IUpdateWarehousePayload) => {
    const existing = await prisma.warehouse.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Warehouse not found");
    }

    if (payload.code && payload.code !== existing.code) {
        await ensureUniqueCode(payload.code, id);
    }

    const updated = await prisma.warehouse.update({ where: { id }, data: payload });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Warehouse", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

const deleteWarehouse = async (userId: string, id: string) => {
    const existing = await prisma.warehouse.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Warehouse not found");
    }

    try {
        const deleted = await prisma.warehouse.delete({ where: { id } });
        await AuditLogService.record(userId, AuditAction.DELETE, "Warehouse", id, { oldData: existing });
        return deleted;
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
            throw new AppError(
                status.CONFLICT,
                "Cannot delete a warehouse that still has stock or stock movement records",
            );
        }
        throw error;
    }
};

export const WarehouseService = {
    createWarehouse,
    getWarehouses,
    getWarehouseById,
    updateWarehouse,
    deleteWarehouse,
};
