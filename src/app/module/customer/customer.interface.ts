import { AddressType } from "../../../generated/prisma/client";

export interface ICreateAddressPayload {
    type?: AddressType;
    fullName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state?: string;
    postalCode?: string;
    country?: string;
    isDefault?: boolean;
}

export type IUpdateAddressPayload = Partial<ICreateAddressPayload>;
