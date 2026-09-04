export interface ICreateShipmentPayload {
    trackingNumber?: string;
    carrier?: string;
    status?: "PENDING" | "PROCESSING" | "SHIPPED" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "RETURNED";
}

export type IUpdateShipmentPayload = Partial<ICreateShipmentPayload> & {
    shippedAt?: string;
    deliveredAt?: string;
};
