import { prisma } from "../../lib/prisma";
import { IUpdateStoreSettingPayload } from "./store-setting.interface";

/** Fixed id of the one-and-only `StoreSetting` row — see prisma/schema/StoreSetting.prisma. */
const SINGLETON_ID = "singleton";

/** Upserts on the fixed singleton id — there is no way, through this service, to end up with a second row. */
const getStoreSetting = async () => {
    return prisma.storeSetting.upsert({
        where: { id: SINGLETON_ID },
        update: {},
        create: { id: SINGLETON_ID },
    });
};

const updateStoreSetting = async (payload: IUpdateStoreSettingPayload) => {
    return prisma.storeSetting.upsert({
        where: { id: SINGLETON_ID },
        update: payload,
        create: { id: SINGLETON_ID, ...payload },
    });
};

export const StoreSettingService = {
    getStoreSetting,
    updateStoreSetting,
};
