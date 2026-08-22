import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { AuditAction, Prisma } from "../../../generated/prisma/client";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AuditLogService } from "../audit-log/audit-log.service";
import { ICreateSupplierPayload, IUpdateSupplierPayload } from "./supplier.interface";

const createSupplier = async (userId: string, payload: ICreateSupplierPayload) => {
    const supplier = await prisma.supplier.create({ data: payload });

    await AuditLogService.record(userId, AuditAction.CREATE, "Supplier", supplier.id, {
        newData: supplier,
    });

    return supplier;
};

const getSuppliers = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.supplier, queryParams, {
        searchableFields: ["name", "companyName", "email", "phone"],
        filterableFields: ["isActive", "country"],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

const getSupplierById = async (id: string) => {
    const supplier = await prisma.supplier.findUnique({ where: { id } });

    if (!supplier) {
        throw new AppError(status.NOT_FOUND, "Supplier not found");
    }

    return supplier;
};

const updateSupplier = async (userId: string, id: string, payload: IUpdateSupplierPayload) => {
    const existing = await prisma.supplier.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Supplier not found");
    }

    const updated = await prisma.supplier.update({ where: { id }, data: payload });

    await AuditLogService.record(userId, AuditAction.UPDATE, "Supplier", id, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

const deleteSupplier = async (userId: string, id: string) => {
    const existing = await prisma.supplier.findUnique({ where: { id } });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Supplier not found");
    }

    try {
        const deleted = await prisma.supplier.delete({ where: { id } });
        await AuditLogService.record(userId, AuditAction.DELETE, "Supplier", id, { oldData: existing });
        return deleted;
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
            throw new AppError(
                status.CONFLICT,
                "Cannot delete a supplier that still has purchase orders",
            );
        }
        throw error;
    }
};

export const SupplierService = {
    createSupplier,
    getSuppliers,
    getSupplierById,
    updateSupplier,
    deleteSupplier,
};
