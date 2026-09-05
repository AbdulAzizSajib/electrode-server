import status from "http-status";
import {
    AuditAction,
    Prisma,
    PurchaseOrderStatus,
} from "../../../generated/prisma/client";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { currencyFormatOfTx, formatMoney } from "../../utils/formatMoney";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
    ICreateSupplierPaymentPayload,
    ISupplierPaymentSettlement,
    IUpdateSupplierPaymentPayload,
} from "./supplier-payment.interface";

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Purchase order states that cannot be settled. A DRAFT is not yet a
 * commitment to anyone and a CANCELLED one is a commitment that was withdrawn;
 * money attached to either describes nothing (`inventory/supplier-payments`).
 */
const UNPAYABLE_STATUSES: PurchaseOrderStatus[] = [
    PurchaseOrderStatus.DRAFT,
    PurchaseOrderStatus.CANCELLED,
];

const unpayableMessage = (state: PurchaseOrderStatus) =>
    state === PurchaseOrderStatus.DRAFT
        ? "This purchase order is still a draft. Place the order before recording a payment against it."
        : "This purchase order has been cancelled and cannot be paid.";

/**
 * Derives the settlement position from a total and what has been paid against
 * it. The one place the three-way state is decided, so the detail view, the
 * list view and the purchases report cannot disagree about what "settled"
 * means. Compares in paisa to keep a 0.005 float residue from reading as an
 * unpaid balance.
 */
export const deriveSettlement = (
    totalAmount: number,
    amountPaid: number,
): ISupplierPaymentSettlement => {
    const total = round2(totalAmount);
    const paid = round2(amountPaid);
    const balanceDue = round2(total - paid);

    const settlementState =
        Math.round(paid * 100) <= 0
            ? "UNPAID"
            : Math.round(balanceDue * 100) <= 0
              ? "SETTLED"
              : "PARTIALLY_PAID";

    return { totalAmount: total, amountPaid: paid, balanceDue, settlementState };
};

/**
 * Sums payments for many purchase orders in one round trip.
 *
 * Exported because the purchase order list, the purchase order detail view and
 * the purchases report all need the same number, and three separate `_sum`
 * queries written three times is how the two figures start disagreeing.
 */
export const sumPaymentsByPurchaseOrder = async (
    purchaseOrderIds: string[],
): Promise<Map<string, number>> => {
    if (purchaseOrderIds.length === 0) return new Map();

    const grouped = await prisma.supplierPayment.groupBy({
        by: ["purchaseOrderId"],
        where: { purchaseOrderId: { in: purchaseOrderIds } },
        _sum: { amount: true },
    });

    return new Map(
        grouped.map((row) => [row.purchaseOrderId, round2(Number(row._sum.amount ?? 0))]),
    );
};

/**
 * The overpayment guard, run against the transaction client so the read of
 * "what has been paid so far" and the write that adds to it cannot be
 * interleaved by a second request. A check-then-write outside a transaction is
 * exactly the race `inventory/supplier-payments` names in its "concurrent
 * payments cannot overshoot together" scenario.
 *
 * `excludePaymentId` is set on the correction path so amending a payment
 * compares against the other payments, not against itself.
 */
const assertPayable = async (
    tx: Prisma.TransactionClient,
    purchaseOrderId: string,
    incomingAmount: number,
    excludePaymentId?: string,
) => {
    const purchaseOrder = await tx.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        select: { id: true, status: true, totalAmount: true, supplierId: true, purchaseNumber: true },
    });

    if (!purchaseOrder) {
        throw new AppError(status.NOT_FOUND, "Purchase order not found");
    }

    if (UNPAYABLE_STATUSES.includes(purchaseOrder.status)) {
        throw new AppError(status.BAD_REQUEST, unpayableMessage(purchaseOrder.status));
    }

    const others = await tx.supplierPayment.aggregate({
        where: {
            purchaseOrderId,
            ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}),
        },
        _sum: { amount: true },
    });

    const total = round2(Number(purchaseOrder.totalAmount));
    const alreadyPaid = round2(Number(others._sum.amount ?? 0));
    const outstanding = round2(total - alreadyPaid);

    // Compared in paisa: `30000.1 + 19999.9 > 50000` is true in float
    // arithmetic, and rejecting a payment that exactly settles a balance is
    // the one thing the spec explicitly forbids.
    if (Math.round(incomingAmount * 100) > Math.round(outstanding * 100)) {
        /*
         * The currency format is read HERE rather than at the top of the
         * function, and through `tx` rather than the global client: the happy
         * path — which is nearly every call — then pays nothing for it, and the
         * one query the failure path does add stays on the transaction's own
         * connection instead of asking the pool for a second one mid-transaction.
         */
        const money = await currencyFormatOfTx(tx);
        throw new AppError(
            status.BAD_REQUEST,
            `Payment of ${formatMoney(incomingAmount, money)} exceeds the outstanding balance of ${formatMoney(outstanding, money)} on this purchase order.`,
        );
    }

    return { purchaseOrder, alreadyPaid, outstanding };
};

const recordPayment = async (
    userId: string,
    purchaseOrderId: string,
    payload: ICreateSupplierPaymentPayload,
) => {
    const payment = await prisma.$transaction(async (tx) => {
        const { purchaseOrder } = await assertPayable(tx, purchaseOrderId, payload.amount);

        return tx.supplierPayment.create({
            data: {
                purchaseOrderId,
                // Read off the purchase order, never off the request body — a
                // payment can then not name a supplier the purchase order does
                // not belong to.
                supplierId: purchaseOrder.supplierId,
                amount: payload.amount,
                method: payload.method,
                paidAt: payload.paidAt ? new Date(payload.paidAt) : new Date(),
                reference: payload.reference,
                note: payload.note,
            },
            include: { supplier: { select: { id: true, name: true, companyName: true } } },
        });
    });

    await AuditLogService.record(userId, AuditAction.CREATE, "SupplierPayment", payment.id, {
        newData: payment,
    });

    return payment;
};

const listPayments = async (purchaseOrderId: string) => {
    const purchaseOrder = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        select: { id: true, totalAmount: true },
    });

    if (!purchaseOrder) {
        throw new AppError(status.NOT_FOUND, "Purchase order not found");
    }

    const payments = await prisma.supplierPayment.findMany({
        where: { purchaseOrderId },
        orderBy: { paidAt: "desc" },
        include: { supplier: { select: { id: true, name: true, companyName: true } } },
    });

    const amountPaid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);

    // Returned alongside the rows so the detail page never has to add the
    // amounts itself and drift from what the list endpoint reports.
    return {
        payments,
        ...deriveSettlement(Number(purchaseOrder.totalAmount), amountPaid),
    };
};

const updatePayment = async (
    userId: string,
    purchaseOrderId: string,
    paymentId: string,
    payload: IUpdateSupplierPaymentPayload,
) => {
    const existing = await prisma.supplierPayment.findUnique({ where: { id: paymentId } });

    if (!existing || existing.purchaseOrderId !== purchaseOrderId) {
        throw new AppError(status.NOT_FOUND, "Payment not found on this purchase order");
    }

    const updated = await prisma.$transaction(async (tx) => {
        // Re-checked even when `amount` is untouched: the purchase order's
        // total can have been edited since, so an amount that fitted when it
        // was recorded may not fit now.
        const nextAmount = payload.amount ?? Number(existing.amount);
        await assertPayable(tx, purchaseOrderId, nextAmount, paymentId);

        return tx.supplierPayment.update({
            where: { id: paymentId },
            data: {
                amount: payload.amount,
                method: payload.method,
                paidAt: payload.paidAt ? new Date(payload.paidAt) : undefined,
                reference: payload.reference,
                note: payload.note,
            },
            include: { supplier: { select: { id: true, name: true, companyName: true } } },
        });
    });

    await AuditLogService.record(userId, AuditAction.UPDATE, "SupplierPayment", paymentId, {
        oldData: existing,
        newData: updated,
    });

    return updated;
};

const deletePayment = async (userId: string, purchaseOrderId: string, paymentId: string) => {
    const existing = await prisma.supplierPayment.findUnique({ where: { id: paymentId } });

    if (!existing || existing.purchaseOrderId !== purchaseOrderId) {
        throw new AppError(status.NOT_FOUND, "Payment not found on this purchase order");
    }

    const deleted = await prisma.supplierPayment.delete({ where: { id: paymentId } });

    await AuditLogService.record(userId, AuditAction.DELETE, "SupplierPayment", paymentId, {
        oldData: existing,
    });

    return deleted;
};

export const SupplierPaymentService = {
    recordPayment,
    listPayments,
    updatePayment,
    deletePayment,
};
