export interface ICreateShipmentPayload {
    trackingNumber?: string;
    carrier?: string;
    status?: "PENDING" | "PROCESSING" | "SHIPPED" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "RETURNED";
}

export type IUpdateShipmentPayload = Partial<ICreateShipmentPayload> & {
    /** Absent leaves the value alone; `null` clears it; a date sets it. A wrongly-stamped date must be removable. */
    shippedAt?: string | null;
    deliveredAt?: string | null;
};
