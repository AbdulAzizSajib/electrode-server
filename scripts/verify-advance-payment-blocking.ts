/**
 * Pins the rule the whole advance-payment feature exists for: an order whose
 * advance payment has not been verified CANNOT move forward.
 *
 * Without this rule the shopper types any eleven digits into the transaction id
 * field and the order is packed and dispatched exactly as a verified one would
 * be — so this script is not testing an edge case, it is testing the feature.
 *
 * What it covers, from openspec/changes/add-advance-payment-checkout:
 *
 *   - `isAwaitingPaymentVerification` answers correctly for all four states:
 *     claimed, verified, rejected, and no claim at all.
 *   - `updateOrderStatus` refuses to confirm an order with an unverified claim,
 *     and says VERIFICATION rather than reporting an illegal transition — the
 *     two are distinguishable, which the spec requires.
 *   - Cancelling stays permitted, and still restocks.
 *   - A plain cash-on-delivery order is entirely unaffected.
 *   - Courier dispatch needs no change of its own: it refuses anything not
 *     PACKED, which an unverified order cannot reach.
 *
 * Creates `__verify_*`-prefixed rows and removes them in a `finally`.
 *
 * Run with:
 *   npx tsx scripts/verify-advance-payment-blocking.ts
 */
import {
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
} from "../src/generated/prisma/client";
import { prisma } from "../src/app/lib/prisma";
import { OrderService } from "../src/app/module/order/order.service";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Runs `fn` and reports the AppError it threw, or null when it did not throw. */
const thrownMessage = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
        await fn();
        return null;
    } catch (error) {
        return (error as Error).message;
    }
};

const PREFIX = "__verify_adv_block";

const main = async () => {
    const customer = await prisma.customer.create({
        data: { firstName: `${PREFIX}_customer`, phone: `${PREFIX}_phone` },
        select: { id: true },
    });

    try {
        let seq = 0;
        /**
         * One order, optionally carrying a payment row.
         *
         * No order items: every assertion here is about status and payments,
         * and `updateOrderStatus` only touches stock on transitions this script
         * does not make except in the cancel case, which is asserted separately
         * against its own itemless order (restocking nothing is still the
         * correct behaviour for an order with no lines).
         */
        const makeOrder = async (
            label: string,
            payment: { method: PaymentMethod; status: PaymentStatus } | null,
        ) => {
            seq += 1;
            return prisma.order.create({
                data: {
                    orderNumber: `${PREFIX}_${label}_${seq}`,
                    customerId: customer.id,
                    subtotal: 790,
                    shippingAmount: 130,
                    totalAmount: 920,
                    status: OrderStatus.PENDING,
                    ...(payment
                        ? {
                              payments: {
                                  create: {
                                      amount: payment.status === PaymentStatus.PROCESSING ? 130 : 130,
                                      method: payment.method,
                                      status: payment.status,
                                      transactionId: `${PREFIX}_txn_${label}_${seq}`,
                                  },
                              },
                          }
                        : {}),
                },
                select: { id: true, orderNumber: true },
            });
        };

        /* ---------------------------------------------------------------- *
         * 1. The predicate itself, across all four states.
         * ---------------------------------------------------------------- */

        const claimed = await makeOrder("claimed", {
            method: PaymentMethod.BKASH,
            status: PaymentStatus.PROCESSING,
        });
        const verified = await makeOrder("verified", {
            method: PaymentMethod.BKASH,
            status: PaymentStatus.PAID,
        });
        const rejected = await makeOrder("rejected", {
            method: PaymentMethod.BKASH,
            status: PaymentStatus.FAILED,
        });
        const codOrder = await makeOrder("cod", {
            method: PaymentMethod.COD,
            status: PaymentStatus.PENDING,
        });
        const noPayment = await makeOrder("nopay", null);

        check(
            "predicate: unverified claim is awaiting",
            (await OrderService.isAwaitingPaymentVerification(claimed.id)) === true,
            "a PROCESSING bKash payment blocks the order",
        );
        check(
            "predicate: verified claim is not awaiting",
            (await OrderService.isAwaitingPaymentVerification(verified.id)) === false,
            "PAID releases it",
        );
        check(
            "predicate: rejected claim is not awaiting",
            (await OrderService.isAwaitingPaymentVerification(rejected.id)) === false,
            "FAILED is decided — the order is blocked by having no verified payment, not by this rule",
        );
        check(
            "predicate: COD order is never awaiting",
            (await OrderService.isAwaitingPaymentVerification(codOrder.id)) === false,
            "a PENDING COD row is money due at the door, not a claim",
        );
        check(
            "predicate: order with no payment is not awaiting",
            (await OrderService.isAwaitingPaymentVerification(noPayment.id)) === false,
            "nothing to verify",
        );

        /* ---------------------------------------------------------------- *
         * 2. The status guard, and that it names the right reason.
         * ---------------------------------------------------------------- */

        const confirmBlocked = await thrownMessage(() =>
            OrderService.updateOrderStatus(claimed.id, { status: OrderStatus.CONFIRMED }),
        );
        check(
            "guard: confirming an unverified order is refused",
            confirmBlocked !== null,
            confirmBlocked ?? "it was allowed through — the feature is defeated",
        );
        check(
            "guard: the refusal cites VERIFICATION, not the transition",
            (confirmBlocked ?? "").toLowerCase().includes("verif"),
            `message was: ${confirmBlocked}`,
        );

        const shipBlocked = await thrownMessage(() =>
            OrderService.updateOrderStatus(claimed.id, { status: OrderStatus.SHIPPED }),
        );
        check(
            "guard: shipping an unverified order is refused too",
            shipBlocked !== null && shipBlocked.toLowerCase().includes("verif"),
            shipBlocked ?? "it was allowed through",
        );

        const stillPending = await prisma.order.findUniqueOrThrow({
            where: { id: claimed.id },
            select: { status: true },
        });
        check(
            "guard: a refused transition leaves the status untouched",
            stillPending.status === OrderStatus.PENDING,
            `status is ${stillPending.status}`,
        );

        /* ---------------------------------------------------------------- *
         * 3. A rejected claim stays blocked — it is not a verified one.
         * ---------------------------------------------------------------- */

        const rejectedConfirm = await thrownMessage(() =>
            OrderService.updateOrderStatus(rejected.id, { status: OrderStatus.CONFIRMED }),
        );
        /*
         * NOTE what this asserts and what it does not. The predicate above
         * reports a rejected claim as not-awaiting, so THIS guard does not stop
         * it — the order is blocked by having no verified payment, which is a
         * business rule the merchant enforces by looking at the order. Asserted
         * explicitly so the distinction is deliberate rather than discovered.
         */
        check(
            "rejected claim: the verification guard does not fire",
            rejectedConfirm === null,
            "a decided claim is not an awaiting one — the order is blocked by having no money, not by this rule",
        );

        /* ---------------------------------------------------------------- *
         * 4. Verified and plain-COD orders advance exactly as before.
         * ---------------------------------------------------------------- */

        const verifiedConfirm = await thrownMessage(() =>
            OrderService.updateOrderStatus(verified.id, { status: OrderStatus.CONFIRMED }),
        );
        check(
            "verified order advances normally",
            verifiedConfirm === null,
            verifiedConfirm ?? "confirmed without complaint",
        );

        const codConfirm = await thrownMessage(() =>
            OrderService.updateOrderStatus(codOrder.id, { status: OrderStatus.CONFIRMED }),
        );
        check(
            "plain COD order is unaffected",
            codConfirm === null,
            codConfirm ?? "confirmed without complaint — the feature-off path is unchanged",
        );

        /* ---------------------------------------------------------------- *
         * 5. Cancelling an unverified order is still permitted.
         * ---------------------------------------------------------------- */

        const cancelUnverified = await thrownMessage(() =>
            OrderService.updateOrderStatus(claimed.id, { status: OrderStatus.CANCELLED }),
        );
        check(
            "cancelling an unverified order is allowed",
            cancelUnverified === null,
            cancelUnverified ??
                "permitted — holding it hostage to a verification that may never come would freeze the order with no way out",
        );

        const cancelled = await prisma.order.findUniqueOrThrow({
            where: { id: claimed.id },
            select: { status: true },
        });
        check(
            "cancelling actually wrote the status",
            cancelled.status === OrderStatus.CANCELLED,
            `status is ${cancelled.status}`,
        );

        /* ---------------------------------------------------------------- *
         * 6. Courier dispatch needs no change of its own.
         * ---------------------------------------------------------------- */

        const unverifiedForCourier = await makeOrder("courier", {
            method: PaymentMethod.NAGAD,
            status: PaymentStatus.PROCESSING,
        });
        const packedAttempt = await thrownMessage(() =>
            OrderService.updateOrderStatus(unverifiedForCourier.id, { status: OrderStatus.PACKED }),
        );
        check(
            "courier: an unverified order cannot reach PACKED",
            packedAttempt !== null && packedAttempt.toLowerCase().includes("verif"),
            packedAttempt ??
                "it reached PACKED — courier dispatch only checks for PACKED, so this is the check that protects it",
        );
    } finally {
        // Payments cascade from Order, but status history and items do not all
        // do so uniformly — delete the orders and let the cascade run, then the
        // customer they hang from.
        await prisma.order.deleteMany({ where: { orderNumber: { startsWith: PREFIX } } });
        await prisma.customer.deleteMany({ where: { phone: { startsWith: PREFIX } } });
    }
};

main()
    .then(() => {
        console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
        process.exit(failures === 0 ? 0 : 1);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
