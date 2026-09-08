/**
 * The courier's status vocabulary, and how it maps onto ours.
 *
 * Steadfast reports eleven values through the polling endpoints and five through
 * the webhook, against our eight `ShipmentStatus` members. The mapping is
 * therefore lossy in one direction, which is exactly why `Shipment.courierStatus`
 * keeps the raw string: this module decides what we *do*, the raw value stays
 * the record of what we were *told*.
 *
 * See openspec/changes/add-steadfast-courier-integration, design.md Decision 3.
 */
import { ShipmentStatus } from "../../../generated/prisma/client";

/**
 * Normalises a courier status for comparison.
 *
 * Necessary, not cosmetic: Steadfast's webhook documentation lists lowercase
 * values while its own example payload sends `"status": "Delivered"`. A
 * case-sensitive comparison would silently fail to recognise a delivery.
 */
export const normaliseCourierStatus = (raw: string): string =>
    raw.trim().toLowerCase();

/** Settled at the courier — money has moved and nothing further will happen. */
const TERMINAL_STATUSES = new Set([
    "delivered",
    "partial_delivered",
    "cancelled",
]);

/**
 * States a human has to look at.
 *
 * `cancelled` means the parcel is coming back. `partial_delivered` means some of
 * it did and some of it did not, which no automatic rule can resolve — what was
 * actually collected, what is being returned, and what the customer owes are all
 * questions only the operator can answer.
 */
const ATTENTION_STATUSES = new Set(["cancelled", "partial_delivered"]);

export const isTerminalCourierStatus = (raw: string): boolean =>
    TERMINAL_STATUSES.has(normaliseCourierStatus(raw));

export const needsAttention = (raw: string): boolean =>
    ATTENTION_STATUSES.has(normaliseCourierStatus(raw));

/**
 * Whether this status means the order itself is delivered.
 *
 * Deliberately exact. `partial_delivered` does NOT qualify: advancing an order
 * to DELIVERED on a partial delivery would close it while goods are still coming
 * back, and DELIVERED → CANCELLED is not a transition the order state machine
 * offers — so the mistake would be unrecoverable through the normal path.
 */
export const isFullyDelivered = (raw: string): boolean =>
    normaliseCourierStatus(raw) === "delivered";

/**
 * The shipment status implied by a courier status.
 *
 * Conservative by construction. Everything in flight lands on IN_TRANSIT rather
 * than guessing at a finer stage the courier has not actually reported, because
 * a wrong precise answer reads as fact while a vague true one reads as vague.
 */
export const toShipmentStatus = (raw: string): ShipmentStatus => {
    switch (normaliseCourierStatus(raw)) {
        // Accepted but not yet collected — the courier has it on paper only.
        case "in_review":
            return ShipmentStatus.PROCESSING;

        case "delivered":
            return ShipmentStatus.DELIVERED;

        // The parcel completed its journey; "partial" describes the items, not
        // the delivery. The order is deliberately NOT advanced — see
        // isFullyDelivered above.
        case "partial_delivered":
            return ShipmentStatus.DELIVERED;

        case "cancelled":
            return ShipmentStatus.RETURNED;

        /*
         * Every approval-pending value maps here rather than to its settled
         * counterpart. `delivered_approval_pending` and `delivered` would
         * otherwise both read as DELIVERED, yet only the second means the
         * merchant has been paid — and that distinction is the whole reason the
         * raw status is stored separately.
         */
        case "delivered_approval_pending":
        case "partial_delivered_approval_pending":
        case "cancelled_approval_pending":
        case "unknown_approval_pending":
        case "pending":
        case "hold":
            return ShipmentStatus.IN_TRANSIT;

        /*
         * `unknown` is the courier telling us to contact support. It is not a
         * failure of the parcel, so FAILED would be a lie; it stays in transit
         * and the raw value is what the panel shows.
         */
        case "unknown":
        default:
            return ShipmentStatus.IN_TRANSIT;
    }
};
