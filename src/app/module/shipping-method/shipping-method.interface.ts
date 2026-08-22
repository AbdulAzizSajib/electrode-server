export interface ICreateShippingMethodPayload {
    name: string;
    description?: string;
    price: number;
    estimatedDays?: number;
    isActive?: boolean;
}

export type IUpdateShippingMethodPayload = Partial<ICreateShippingMethodPayload>;
