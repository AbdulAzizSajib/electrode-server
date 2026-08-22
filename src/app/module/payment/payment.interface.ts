import { Prisma } from "../../../generated/prisma/client";

export interface ICreatePaymentPayload {
    method: "COD" | "CARD" | "BKASH" | "NAGAD" | "ROCKET" | "STRIPE" | "PAYPAL" | "BANK_TRANSFER";
    status?: "PENDING" | "PROCESSING" | "PAID" | "FAILED" | "CANCELLED" | "REFUNDED" | "PARTIALLY_REFUNDED";
    /** Defaults to the order's totalAmount when omitted. */
    amount?: number;
    transactionId?: string;
    gateway?: string;
    gatewayResponse?: Prisma.InputJsonValue;
    paidAt?: string;
}
