export interface ICreateSupplierPayload {
    name: string;
    companyName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
    isActive?: boolean;
}

export type IUpdateSupplierPayload = Partial<ICreateSupplierPayload>;
