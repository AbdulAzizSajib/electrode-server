import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { IQueryParams } from "../../interfaces/query.interface";
import { prisma } from "../../lib/prisma";
import { QueryBuilder } from "../../utils/QueryBuilder";
import {
    ICreateShippingMethodPayload,
    IUpdateShippingMethodPayload,
} from "./shipping-method.interface";

const createShippingMethod = async (payload: ICreateShippingMethodPayload) => {
    return prisma.shippingMethod.create({ data: payload });
};

const getPublicShippingMethods = async () => {
    return prisma.shippingMethod.findMany({
        where: { isActive: true },
        orderBy: { price: "asc" },
    });
};

const getAdminShippingMethods = async (queryParams: IQueryParams) => {
    const queryBuilder = new QueryBuilder(prisma.shippingMethod, queryParams, {
        searchableFields: ["name"],
        filterableFields: ["isActive"],
    });

    return queryBuilder.search().filter().sort().paginate().execute();
};

const getAdminShippingMethodById = async (id: string) => {
    const method = await prisma.shippingMethod.findUnique({ where: { id } });

    if (!method) {
        throw new AppError(status.NOT_FOUND, "Shipping method not found");
    }

    return method;
};

const updateShippingMethod = async (id: string, payload: IUpdateShippingMethodPayload) => {
    await getAdminShippingMethodById(id);

    return prisma.shippingMethod.update({ where: { id }, data: payload });
};

const deleteShippingMethod = async (id: string) => {
    await getAdminShippingMethodById(id);

    return prisma.shippingMethod.delete({ where: { id } });
};

export const ShippingMethodService = {
    createShippingMethod,
    getPublicShippingMethods,
    getAdminShippingMethods,
    getAdminShippingMethodById,
    updateShippingMethod,
    deleteShippingMethod,
};
