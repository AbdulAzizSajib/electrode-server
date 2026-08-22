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
}
