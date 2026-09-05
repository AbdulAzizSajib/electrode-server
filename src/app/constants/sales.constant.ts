import { OrderStatus, PaymentStatus } from "../../generated/prisma/client";

/**
 * The one definition of "a sale", shared by AnalyticsService (which powers the
 * admin dashboard) and ReportService (which powers the Sales report).
 *
 * The `admin-reporting/sales-reports` spec requires that the dashboard and the
 * Sales report never state different revenue for the same window. A comment
 * saying "keep these in sync" is not a mechanism; a shared constant makes
 * divergence require editing one place that breaks both.
 *
 * An order counts as a sale when it is not CANCELLED — including one that is
 * still PENDING and one that has not been paid for. It is booked revenue, not
 * collected cash; the two are reported as separate columns.
 */
export const SALES_ORDER_WHERE = {
    status: { not: OrderStatus.CANCELLED },
} as const;

/**
 * Payment states that mean the money actually arrived, and so are the only
 * ones the reports count as *collected*.
 *
 * `PARTIALLY_REFUNDED` is included because the money did arrive — some of it
 * was later sent back, which the reports state as a separate refunded figure
 * rather than by removing the payment from collected. `PENDING` is excluded,
 * which is what makes an uncollected COD parcel show up as outstanding rather
 * than as revenue in hand.
 *
 * Deliberately broader than `PAID_PAYMENT_STATUSES` in payment.service.ts:
 * that list answers "did this sale happen, for Product.totalSold", where a
 * partial refund leaves the unit count untouched. This one answers "did money
 * arrive", where it does not.
 */
export const SETTLED_PAYMENT_STATUSES: PaymentStatus[] = [
    PaymentStatus.PAID,
    PaymentStatus.PARTIALLY_REFUNDED,
];
