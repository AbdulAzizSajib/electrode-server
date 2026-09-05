import { SupplierPaymentMethod } from "../../../generated/prisma/client";

/**
 * `supplierId` is deliberately absent from both payloads. It is read off the
 * purchase order by the service so a payment can never name a supplier its
 * purchase order does not belong to — see prisma/schema/SupplierPayment.prisma
 * and the `inventory/supplier-payments` spec's "supplier is not separately
 * selectable" scenario.
 */
export interface ICreateSupplierPaymentPayload {
    amount: number;
    method: SupplierPaymentMethod;
    /** Defaults to now when omitted; settable so a payment made last week lands in last week's report. */
    paidAt?: string;
    reference?: string;
    note?: string;
}

/** Every field optional — this is a correction, and a merchant may be fixing only the amount. */
export interface IUpdateSupplierPaymentPayload {
    amount?: number;
    method?: SupplierPaymentMethod;
    paidAt?: string;
    reference?: string | null;
    note?: string | null;
}

/** Settlement position of one purchase order, computed on read — never stored. */
export interface ISupplierPaymentSettlement {
    totalAmount: number;
    amountPaid: number;
    balanceDue: number;
    settlementState: "UNPAID" | "PARTIALLY_PAID" | "SETTLED";
}
