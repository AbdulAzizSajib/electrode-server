/**
 * Tasks 2.7 and 3.4 — supplier payment verification.
 *
 * Walks every scenario in the `inventory/supplier-payments` spec that the
 * service layer owns: the amount guards, the unpayable-status guards, the
 * overpayment ceiling (including the exact-settlement boundary the ceiling
 * must NOT reject), the correction path, and the settlement arithmetic on a
 * purchase order.
 *
 * Route-level authorisation (customer session / unauthenticated rejected) is
 * enforced by `checkAuth(...ADMIN_PANEL_ROLES)` on the router and is covered by
 * the Postman collection, not here — this script talks to the service directly
 * and so has no session to withhold.
 *
 * NOT read-only: it creates a supplier and purchase orders prefixed
 * `VERIFY-SUPPLIER-PAYMENTS` and removes them in a `finally`, so a failure
 * part-way through still leaves the database as it found it.
 *
 * Run with: npx tsx scripts/verify-supplier-payments.ts
 */
import { PurchaseOrderStatus } from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { PurchaseOrderService } from "../src/app/module/purchase-order/purchase-order.service";
import { SupplierPaymentService } from "../src/app/module/supplier-payment/supplier-payment.service";
import {
    createSupplierPaymentZodSchema,
    updateSupplierPaymentZodSchema,
} from "../src/app/module/supplier-payment/supplier-payment.validation";

const MARKER = "VERIFY-SUPPLIER-PAYMENTS";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Runs `fn` and reports whether it threw with a message containing `expect`. */
const expectRejection = async (label: string, expect: string, fn: () => Promise<unknown>) => {
    try {
        await fn();
        check(label, false, "expected a rejection but the call succeeded");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        check(label, message.includes(expect), `rejected with "${message}"`);
    }
};

const createPurchaseOrder = async (
    supplierId: string,
    productId: string,
    unitCost: number,
    quantity: number,
    state: PurchaseOrderStatus,
) => {
    const created = await PurchaseOrderService.createPurchaseOrder(undefined as unknown as string, {
        supplierId,
        items: [{ productId, quantity, unitCost }],
        notes: MARKER,
    });

    if (created.status !== state) {
        await prisma.purchaseOrder.update({ where: { id: created.id }, data: { status: state } });
    }

    return created.id;
};

const main = async () => {
    const product = await prisma.product.findFirst({ select: { id: true } });
    if (!product) throw new Error("No product in the database to build a purchase order from");

    // A real user id: AuditLog.userId is a foreign key, and a made-up value
    // makes every audit write fail. AuditLogService swallows that by design, so
    // it would not fail the run — it would just bury the results in stack traces.
    const actingUser = await prisma.user.findFirst({ select: { id: true } });
    if (!actingUser) throw new Error("No user in the database to attribute audit entries to");
    const actingUserId = actingUser.id;

    const supplier = await prisma.supplier.create({
        data: { name: `${MARKER} supplier`, country: "Bangladesh" },
    });

    const createdPurchaseOrderIds: string[] = [];
    const createdPaymentIds: string[] = [];

    try {
        // ---- Zod edge: amount must be positive -------------------------------
        check(
            "zero amount rejected at validation",
            !createSupplierPaymentZodSchema.safeParse({ amount: 0, method: "CASH" }).success,
            "amount: 0 fails the create schema",
        );
        check(
            "negative amount rejected at validation",
            !createSupplierPaymentZodSchema.safeParse({ amount: -100, method: "CASH" }).success,
            "amount: -100 fails the create schema",
        );
        check(
            "COD is not a supplier payment method",
            !createSupplierPaymentZodSchema.safeParse({ amount: 100, method: "COD" }).success,
            "method: COD fails the create schema",
        );
        check(
            "unrecognised method rejected",
            !createSupplierPaymentZodSchema.safeParse({ amount: 100, method: "CRYPTO" }).success,
            "method: CRYPTO fails the create schema",
        );
        check(
            "empty correction rejected",
            !updateSupplierPaymentZodSchema.safeParse({}).success,
            "an update with no fields fails the update schema",
        );

        // ---- Unpayable statuses ---------------------------------------------
        const draftId = await createPurchaseOrder(
            supplier.id,
            product.id,
            500,
            100,
            PurchaseOrderStatus.DRAFT,
        );
        createdPurchaseOrderIds.push(draftId);

        await expectRejection("draft purchase order cannot be paid", "still a draft", () =>
            SupplierPaymentService.recordPayment(actingUserId, draftId, {
                amount: 100,
                method: "CASH",
            }),
        );

        const cancelledId = await createPurchaseOrder(
            supplier.id,
            product.id,
            500,
            100,
            PurchaseOrderStatus.CANCELLED,
        );
        createdPurchaseOrderIds.push(cancelledId);

        await expectRejection("cancelled purchase order cannot be paid", "cancelled", () =>
            SupplierPaymentService.recordPayment(actingUserId, cancelledId, {
                amount: 100,
                method: "CASH",
            }),
        );

        // ---- The 50,000 purchase order the spec's scenarios are written about -
        const poId = await createPurchaseOrder(
            supplier.id,
            product.id,
            500,
            100,
            PurchaseOrderStatus.ORDERED,
        );
        createdPurchaseOrderIds.push(poId);

        const fresh = await SupplierPaymentService.listPayments(poId);
        check(
            "purchase order with no payments",
            fresh.amountPaid === 0 &&
                fresh.balanceDue === 50_000 &&
                fresh.settlementState === "UNPAID" &&
                fresh.payments.length === 0,
            `paid ${fresh.amountPaid}, due ${fresh.balanceDue}, state ${fresh.settlementState}`,
        );

        const first = await SupplierPaymentService.recordPayment(actingUserId, poId, {
            amount: 30_000,
            method: "BANK_TRANSFER",
            reference: `${MARKER}-TXN-1`,
        });
        createdPaymentIds.push(first.id);
        check(
            "supplier taken from the purchase order",
            first.supplierId === supplier.id,
            `payment.supplierId = ${first.supplierId}`,
        );

        const partly = await SupplierPaymentService.listPayments(poId);
        check(
            "partly paid purchase order",
            partly.amountPaid === 30_000 &&
                partly.balanceDue === 20_000 &&
                partly.settlementState === "PARTIALLY_PAID",
            `paid ${partly.amountPaid}, due ${partly.balanceDue}, state ${partly.settlementState}`,
        );

        await expectRejection(
            "payment exceeding the outstanding balance rejected",
            "20000.00",
            () =>
                SupplierPaymentService.recordPayment(actingUserId, poId, {
                    amount: 25_000,
                    method: "CASH",
                }),
        );

        // The boundary the ceiling must not reject.
        const exact = await SupplierPaymentService.recordPayment(actingUserId, poId, {
            amount: 20_000,
            method: "CHEQUE",
        });
        createdPaymentIds.push(exact.id);

        const settled = await SupplierPaymentService.listPayments(poId);
        check(
            "payment that exactly settles the balance is accepted",
            settled.amountPaid === 50_000 &&
                settled.balanceDue === 0 &&
                settled.settlementState === "SETTLED",
            `paid ${settled.amountPaid}, due ${settled.balanceDue}, state ${settled.settlementState}`,
        );

        const summed = settled.payments.reduce((total, p) => total + Number(p.amount), 0);
        check(
            "sum of payments equals amountPaid",
            summed === settled.amountPaid,
            `${summed} === ${settled.amountPaid}`,
        );
        check(
            "totalAmount − amountPaid equals balanceDue",
            settled.totalAmount - settled.amountPaid === settled.balanceDue,
            `${settled.totalAmount} − ${settled.amountPaid} = ${settled.balanceDue}`,
        );

        // ---- Cancellation and deletion are refused while payments exist ------
        await expectRejection(
            "cancelling a paid purchase order is refused",
            "recorded supplier payment",
            () =>
                PurchaseOrderService.updatePurchaseOrder(actingUserId, poId, {
                    status: "CANCELLED",
                }),
        );
        await expectRejection(
            "deleting a paid purchase order is refused",
            "recorded supplier payment",
            () => PurchaseOrderService.deletePurchaseOrder(actingUserId, poId),
        );

        // ---- Corrections -----------------------------------------------------
        await expectRejection("correction cannot overshoot", "exceeds the outstanding", () =>
            SupplierPaymentService.updatePayment(actingUserId, poId, first.id, {
                amount: 40_000,
            }),
        );

        await SupplierPaymentService.updatePayment(actingUserId, poId, first.id, {
            amount: 25_000,
        });
        const corrected = await SupplierPaymentService.listPayments(poId);
        check(
            "correction lowers amountPaid and raises balanceDue",
            corrected.amountPaid === 45_000 &&
                corrected.balanceDue === 5_000 &&
                corrected.settlementState === "PARTIALLY_PAID",
            `paid ${corrected.amountPaid}, due ${corrected.balanceDue}, state ${corrected.settlementState}`,
        );

        await SupplierPaymentService.deletePayment(actingUserId, poId, first.id);
        const afterDelete = await SupplierPaymentService.listPayments(poId);
        check(
            "deleted payment is removed and figures recomputed",
            afterDelete.payments.length === 1 && afterDelete.amountPaid === 20_000,
            `${afterDelete.payments.length} payment(s), paid ${afterDelete.amountPaid}`,
        );

        await expectRejection("payment on another purchase order is not found", "not found", () =>
            SupplierPaymentService.deletePayment(actingUserId, draftId, first.id),
        );

        // ---- The list's balance-owing filter ---------------------------------
        const owing = await PurchaseOrderService.getPurchaseOrders({ hasBalance: "true", limit: "500" });
        const owingIds = new Set(owing.data.map((row) => (row as { id: string }).id));
        check(
            "balance-owing filter includes a partly paid purchase order",
            owingIds.has(poId),
            `${owing.data.length} purchase order(s) owing money`,
        );

        const settledOnlyId = await createPurchaseOrder(
            supplier.id,
            product.id,
            100,
            10,
            PurchaseOrderStatus.ORDERED,
        );
        createdPurchaseOrderIds.push(settledOnlyId);
        const settlingPayment = await SupplierPaymentService.recordPayment(actingUserId, settledOnlyId, {
            amount: 1_000,
            method: "CASH",
        });
        createdPaymentIds.push(settlingPayment.id);
        const owingAfter = await PurchaseOrderService.getPurchaseOrders({
            hasBalance: "true",
            limit: "500",
        });
        check(
            "balance-owing filter excludes a fully settled purchase order",
            !owingAfter.data.some((row) => (row as { id: string }).id === settledOnlyId),
            "a settled purchase order is not listed as owing",
        );

        const listRow = owingAfter.data.find((row) => (row as { id: string }).id === poId) as
            | { settlementState?: string }
            | undefined;
        check(
            "list rows carry a settlement state",
            listRow?.settlementState === "PARTIALLY_PAID",
            `settlementState = ${listRow?.settlementState}`,
        );
    } finally {
        await prisma.supplierPayment.deleteMany({
            where: { purchaseOrderId: { in: createdPurchaseOrderIds } },
        });
        await prisma.purchaseOrderItem.deleteMany({
            where: { purchaseOrderId: { in: createdPurchaseOrderIds } },
        });
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: createdPurchaseOrderIds } } });
        // Scoped to the entity ids this run created — never to `userId`, which
        // would wipe that user's real audit trail.
        await prisma.auditLog.deleteMany({
            where: { entityId: { in: [...createdPaymentIds, ...createdPurchaseOrderIds] } },
        });
        await prisma.supplier.delete({ where: { id: supplier.id } });
        console.log("\nCleaned up verification data.");
    }

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    process.exitCode = failures === 0 ? 0 : 1;
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
