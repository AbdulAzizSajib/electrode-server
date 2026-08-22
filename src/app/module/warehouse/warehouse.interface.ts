export interface ICreateWarehousePayload {
    name: string;
    code: string;
    address?: string;
    city?: string;
    country?: string;
    isActive?: boolean;
}

export type IUpdateWarehousePayload = Partial<ICreateWarehousePayload>;
