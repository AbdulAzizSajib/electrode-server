import { PaymentMethod, PaymentStatus, Prisma } from "../../../generated/prisma/client";

export interface ICreatePaymentPayload {
    method: PaymentMethod;
    status?: PaymentStatus;
    /** Defaults to the order's totalAmount when omitted. */
    amount?: number;
    transactionId?: string;
    gateway?: string;
    gatewayResponse?: Prisma.InputJsonValue;
    paidAt?: string;
}

/**
 * Moves an existing payment to a new status — the transition that maintains
 * `Product.totalSold`. `status` is required: this endpoint exists to change it,
 * and an omitted status would be a no-op request that silently succeeds.
 */
export interface IUpdatePaymentStatusPayload {
    status: PaymentStatus;
    transactionId?: string;
    gateway?: string;
    gatewayResponse?: Prisma.InputJsonValue;
    /** Defaults to now when the payment is transitioning into PAID. */
    paidAt?: string;
}
