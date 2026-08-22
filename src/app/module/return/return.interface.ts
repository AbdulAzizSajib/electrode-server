export interface ICreateReturnItemInput {
    orderItemId: string;
    quantity: number;
    reason?: string;
}

export interface ICreateReturnPayload {
    reason: string;
    description?: string;
    items: ICreateReturnItemInput[];
}

export interface IUpdateReturnStatusPayload {
    status: "REQUESTED" | "APPROVED" | "REJECTED" | "RECEIVED" | "PROCESSING" | "COMPLETED" | "CANCELLED";
    /** Required when `status` is `COMPLETED` — the warehouse that receives the returned stock. */
    warehouseId?: string;
}
