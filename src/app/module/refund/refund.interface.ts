export interface ICreateRefundPayload {
    amount: number;
    reason?: string;
    paymentId?: string;
    /**
     * Optional link to the ReturnRequest this refund settles. The Refund
     * schema has no FK column for this (only orderId/paymentId) — recording
     * it here is a compound action: it moves the ReturnRequest to a
     * terminal (COMPLETED) status, per `api/post-purchase` spec's "Admin
     * issues a refund after approving a return" scenario, without a
     * persisted Refund<->ReturnRequest relation in the data model.
     */
    returnRequestId?: string;
    /**
     * Where the returned goods were received, when this refund settles a return
     * whose items actually came back. Supplying it restocks exactly as
     * completing the return directly would; omitting it records a refund for
     * goods the customer keeps.
     *
     * Required because completing a return means two different things about
     * physical inventory otherwise: `updateReturnStatus` demands a warehouse
     * and restocks, while this path used to force the same terminal status with
     * no warehouse and no restock. Same status, opposite effect on the shelf —
     * so the caller now says which happened instead of the answer depending on
     * which endpoint was used. Ignored when `returnRequestId` is absent.
     */
    restockWarehouseId?: string;
}

/**
 * Only the figures are amendable. Which payment a refund came out of, and which
 * return it settled, decide what voiding has to reverse — changing them on a
 * live refund would leave the recorded prior state describing records the
 * refund no longer touches. Void and re-issue instead.
 */
export interface IUpdateRefundPayload {
    amount?: number;
    reason?: string;
}
