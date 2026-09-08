import status from "http-status";
import { AuditAction, OrderStatus, ShipmentStatus } from "../../../generated/prisma/client";
import { envVars } from "../../config/env";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { AuditLogService } from "../audit-log/audit-log.service";
import { OrderService } from "../order/order.service";
import {
    ICourierActor,
    ICourierDispatchResult,
    ICourierDispatchSummary,
    ICourierEligibility,
    ICourierOrderForDispatch,
    ICourierWebhookPayload,
} from "./courier.interface";
import { mapOrderToConsignment } from "./courier.mapper";
import {
    isFullyDelivered,
    isTerminalCourierStatus,
    needsAttention,
    normaliseCourierStatus,
    toShipmentStatus,
} from "./courier.status";
import {
    CourierNotConfiguredError,
    SteadfastBulkResultItem,
    SteadfastClient,
} from "./steadfast.client";

/**
 * How many consignments one courier request carries.
 *
 * Steadfast allows 500. We send 50, because the binding constraint is not their
 * limit but our 30-second Vercel function: a 500-item call plus its database
 * writes will not finish, and a dispatch that dies after Steadfast has committed
 * is the exact failure this module exists to prevent.
 * See design.md Decision 4.
 */
const BATCH_SIZE = 50;

/** A selection larger than this is refused rather than silently truncated. */
const MAX_SELECTION = 200;

/** How many consignments one reconciliation run examines, to stay inside the
 *  same 30-second ceiling. The rest wait for the next tick. */
const RECONCILE_BATCH = 40;

/** A consignment heard from inside this window is assumed healthy; the job is
 *  looking for silence, not refreshing everything. */
const STALENESS_MINUTES = 90;

const ORDER_FOR_DISPATCH_SELECT = {
    id: true,
    orderNumber: true,
    status: true,
    notes: true,
    totalAmount: true,
    customer: { select: { firstName: true, lastName: true, phone: true } },
    shippingAddress: {
        select: {
            fullName: true,
            phone: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            postalCode: true,
        },
    },
    payments: { select: { amount: true, status: true } },
    shipments: {
        select: { id: true, consignmentId: true },
        orderBy: { createdAt: "desc" as const },
    },
} as const;

const assertConfigured = () => {
    if (!SteadfastClient.isCourierConfigured()) {
        throw new AppError(
            status.SERVICE_UNAVAILABLE,
            "Steadfast is not configured. Set STEADFAST_API_KEY and STEADFAST_SECRET_KEY.",
        );
    }
};

/**
 * One order's verdict, without calling the courier.
 *
 * Order matters: status first, then already-dispatched, then the field checks.
 * An operator seeing "not packed" for an order they know is dispatched would be
 * reading a less useful truth than "already dispatched".
 */
const evaluateOrder = (order: ICourierOrderForDispatch): ICourierEligibility => {
    const base = { orderId: order.id, orderNumber: order.orderNumber };

    const existing = order.shipments.find((shipment) => shipment.consignmentId);

    if (existing) {
        return {
            ...base,
            eligible: false,
            reason: "ALREADY_DISPATCHED",
            detail: "This order has already been sent to the courier.",
            consignmentId: existing.consignmentId,
        };
    }

    if (order.status !== OrderStatus.PACKED) {
        return {
            ...base,
            eligible: false,
            reason: "NOT_PACKED",
            detail: `Only packed orders can be dispatched; this one is ${order.status}.`,
        };
    }

    const mapped = mapOrderToConsignment(order);

    if (!mapped.ok) {
        return { ...base, eligible: false, reason: mapped.reason, detail: mapped.detail };
    }

    return { ...base, eligible: true };
};

/**
 * Loads the selected orders and returns a verdict for each.
 *
 * Deduplicates first: the same order id twice in one request must not become two
 * consignments, and the cheapest place to guarantee that is before anything else
 * runs.
 */
const previewDispatch = async (orderIds: string[]): Promise<ICourierEligibility[]> => {
    const unique = [...new Set(orderIds)];

    if (unique.length === 0) {
        throw new AppError(status.BAD_REQUEST, "Select at least one order to dispatch.");
    }

    if (unique.length > MAX_SELECTION) {
        throw new AppError(
            status.BAD_REQUEST,
            `Too many orders selected (${unique.length}). Dispatch at most ${MAX_SELECTION} at a time and split the rest into a second batch.`,
        );
    }

    const orders = await prisma.order.findMany({
        where: { id: { in: unique } },
        select: ORDER_FOR_DISPATCH_SELECT,
    });

    const found = new Map(orders.map((order) => [order.id, order]));

    // An id that matches no order is reported rather than dropped: silently
    // returning fewer verdicts than orders selected would leave the panel
    // showing a count that does not add up.
    return unique.map((id) => {
        const order = found.get(id);

        if (!order) {
            return {
                orderId: id,
                orderNumber: "—",
                eligible: false,
                reason: "NOT_PACKED" as const,
                detail: "This order no longer exists.",
            };
        }

        return evaluateOrder(order as unknown as ICourierOrderForDispatch);
    });
};

/**
 * Records one accepted consignment against its order.
 *
 * Upserts rather than creates: an order may already carry a hand-entered
 * shipment, and the one-shipment-per-order rule holds however the shipment came
 * to exist. The order advance runs through `OrderService.updateOrderStatus` so
 * `OrderStatusHistory` records it like any other transition.
 */
const recordDispatchedConsignment = async (
    order: { id: string; orderNumber: string; shipments: { id: string }[] },
    consignmentId: string,
    trackingCode: string | null,
    actorUserId: string,
) => {
    const existing = order.shipments[0];

    const data = {
        consignmentId,
        courierInvoice: order.orderNumber,
        courierStatus: "in_review",
        courierSyncedAt: new Date(),
        carrier: "Steadfast",
        trackingNumber: trackingCode,
        status: ShipmentStatus.PROCESSING,
        shippedAt: new Date(),
    };

    if (existing) {
        await prisma.shipment.update({ where: { id: existing.id }, data });
    } else {
        await prisma.shipment.create({ data: { ...data, orderId: order.id } });
    }

    /*
     * The parcel has left. Leaving it PACKED would mean the orders list cannot
     * distinguish a boxed parcel on the bench from one in a courier's van, which
     * is the distinction an operator dispatching in bulk most needs.
     *
     * Failure here is logged, not thrown: the consignment exists at Steadfast
     * and the shipment row is already written. Losing the status advance is a
     * cosmetic inconsistency an operator can fix; throwing would abandon the
     * rest of the batch over it.
     */
    try {
        await OrderService.updateOrderStatus(
            order.id,
            { status: "SHIPPED", note: `Dispatched to Steadfast (consignment ${consignmentId})` },
            actorUserId,
        );
    } catch (error) {
        console.error(
            `Consignment ${consignmentId} was created for order ${order.orderNumber} but the status advance to SHIPPED failed:`,
            error,
        );
    }
};

/**
 * Sends the eligible orders to Steadfast in bounded batches.
 *
 * Each batch is persisted before the next is sent. This is the property that
 * makes a timeout recoverable: a request killed at Vercel's ceiling then loses
 * the RESPONSE, not the RECORD, so the operator refreshes and sees precisely
 * which orders went. Accumulating results and writing once at the end would turn
 * a timeout into an unrecoverable divergence between our database and theirs.
 * See design.md Decision 4.
 */
const dispatchOrders = async (
    orderIds: string[],
    actor: ICourierActor,
): Promise<ICourierDispatchSummary> => {
    assertConfigured();

    const verdicts = await previewDispatch(orderIds);
    const results: ICourierDispatchResult[] = [];

    for (const verdict of verdicts) {
        if (!verdict.eligible) {
            results.push({
                orderId: verdict.orderId,
                orderNumber: verdict.orderNumber,
                outcome: "ineligible",
                reason: verdict.reason,
                detail: verdict.detail,
                consignmentId: verdict.consignmentId,
            });
        }
    }

    const eligibleIds = verdicts.filter((v) => v.eligible).map((v) => v.orderId);

    if (eligibleIds.length === 0) {
        return summarise(results);
    }

    const orders = await prisma.order.findMany({
        where: { id: { in: eligibleIds } },
        select: ORDER_FOR_DISPATCH_SELECT,
    });

    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);

        const payloads = [];
        const byInvoice = new Map<string, (typeof batch)[number]>();

        for (const order of batch) {
            const mapped = mapOrderToConsignment(order as unknown as ICourierOrderForDispatch);

            // Re-checked rather than trusted from the preview: the two reads are
            // separate queries and an order can change between them.
            if (!mapped.ok) {
                results.push({
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    outcome: "ineligible",
                    reason: mapped.reason,
                    detail: mapped.detail,
                });
                continue;
            }

            payloads.push(mapped.payload);
            byInvoice.set(mapped.payload.invoice, order);
        }

        if (payloads.length === 0) continue;

        const response = await SteadfastClient.createBulkOrders(payloads);

        if (response.outcome === "unconfirmed") {
            /*
             * NOT a failure. Aborting our request does not abort Steadfast's
             * handler, so these consignments may well exist. Reporting them as
             * failed would invite the retry that duplicates them.
             */
            for (const order of byInvoice.values()) {
                results.push({
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    outcome: "unconfirmed",
                    detail: response.message,
                });
            }
            continue;
        }

        if (response.outcome === "failed") {
            for (const order of byInvoice.values()) {
                results.push({
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    outcome: "failed",
                    detail: response.message,
                });
            }
            continue;
        }

        const matched = matchResultsByInvoice([...byInvoice.keys()], response.data);

        // Invoices we did not send. Logged and skipped rather than guessed at.
        for (const invoice of matched.unknownInvoices) {
            console.warn(
                `Steadfast returned invoice "${invoice}", which was not in the batch sent. Skipped.`,
            );
        }

        for (const item of matched.accepted) {
            const order = byInvoice.get(item.invoice)!;

            await recordDispatchedConsignment(
                order,
                item.consignmentId,
                item.trackingCode,
                actor.userId,
            );

            results.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                outcome: "dispatched",
                consignmentId: item.consignmentId,
                trackingCode: item.trackingCode,
            });
        }

        for (const invoice of matched.rejected) {
            const order = byInvoice.get(invoice)!;

            results.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                outcome: "failed",
                detail: "The courier rejected this consignment.",
            });
        }

        // Sent but absent from the response. We cannot say it failed, because we
        // cannot say Steadfast did not create it.
        for (const invoice of matched.missing) {
            const order = byInvoice.get(invoice)!;

            results.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                outcome: "unconfirmed",
                detail:
                    "The courier's response did not mention this order, so its outcome is unknown. Check before retrying.",
            });
        }
    }

    const summary = summarise(results);

    void AuditLogService.record(actor.userId, AuditAction.OTHER, "CourierDispatch", undefined, {
        newData: {
            dispatched: summary.results
                .filter((r) => r.outcome === "dispatched")
                .map((r) => ({ orderNumber: r.orderNumber, consignmentId: r.consignmentId })),
            ineligible: summary.ineligible,
            failed: summary.failed,
            unconfirmed: summary.unconfirmed,
        },
    });

    return summary;
};

/**
 * Pairs what we sent with what came back, by `invoice`.
 *
 * Pure and separate so the property that matters can be verified without
 * calling Steadfast: nothing in their documentation promises the response array
 * is ordered like the request, and applying it positionally would write one
 * order's consignment id onto another — a wrong tracking number handed to a
 * customer and a parcel nobody can find. See design.md Decision 5.
 *
 * Returns three groups, because "not in the response" is not the same as
 * "rejected": an invoice we sent and did not hear about may still have been
 * created, so it is unconfirmed rather than failed.
 */
export const matchResultsByInvoice = (
    sentInvoices: string[],
    responseItems: SteadfastBulkResultItem[],
) => {
    const sent = new Set(sentInvoices);
    const accepted: { invoice: string; consignmentId: string; trackingCode: string | null }[] = [];
    const rejected: string[] = [];
    const unknownInvoices: string[] = [];
    const seen = new Set<string>();

    for (const item of responseItems) {
        if (!sent.has(item.invoice)) {
            unknownInvoices.push(item.invoice);
            continue;
        }

        seen.add(item.invoice);

        const succeeded =
            normaliseCourierStatus(String(item.status ?? "")) === "success" &&
            item.consignment_id != null;

        if (succeeded) {
            accepted.push({
                invoice: item.invoice,
                consignmentId: String(item.consignment_id),
                trackingCode: item.tracking_code ?? null,
            });
        } else {
            rejected.push(item.invoice);
        }
    }

    return {
        accepted,
        rejected,
        unknownInvoices,
        missing: sentInvoices.filter((invoice) => !seen.has(invoice)),
    };
};

const summarise = (results: ICourierDispatchResult[]): ICourierDispatchSummary => ({
    dispatched: results.filter((r) => r.outcome === "dispatched").length,
    ineligible: results.filter((r) => r.outcome === "ineligible").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    unconfirmed: results.filter((r) => r.outcome === "unconfirmed").length,
    results,
});

/**
 * The single place a courier status is applied to a shipment.
 *
 * Both the webhook and the reconciliation job come through here, so the two
 * paths cannot drift — two paths writing the same state by different rules is
 * how a panel comes to disagree with itself. See design.md Decision 7.
 *
 * Idempotent: applying a status the shipment already holds touches only
 * `courierSyncedAt`, which is what makes a re-delivered webhook and a
 * double-fired cron equally harmless.
 */
const applyCourierStatus = async (
    shipment: { id: string; orderId: string; courierStatus: string | null },
    rawStatus: string,
    observedAt: Date,
) => {
    const normalised = normaliseCourierStatus(rawStatus);
    const unchanged = normaliseCourierStatus(shipment.courierStatus ?? "") === normalised;

    if (unchanged) {
        // Still worth recording that we heard from the courier — that timestamp
        // is what the reconciliation job selects on.
        await prisma.shipment.update({
            where: { id: shipment.id },
            data: { courierSyncedAt: observedAt },
        });
        return;
    }

    await prisma.shipment.update({
        where: { id: shipment.id },
        data: {
            courierStatus: normalised,
            courierSyncedAt: observedAt,
            status: toShipmentStatus(normalised),
            ...(isFullyDelivered(normalised) ? { deliveredAt: observedAt } : {}),
        },
    });

    /*
     * Only an exact `delivered` advances the order. `partial_delivered` does not:
     * closing an order while goods are still coming back would be unrecoverable
     * through the normal path, since DELIVERED offers no transition back.
     *
     * A cancellation deliberately does nothing here — not the order status, not
     * stock, not a refund. The parcel is on its way back, and restocking on the
     * courier's signal would advertise goods the shop does not hold. The order
     * surfaces as needing attention instead, and staff resolve it through the
     * existing cancellation flow.
     */
    if (isFullyDelivered(normalised)) {
        try {
            await OrderService.updateOrderStatus(
                shipment.orderId,
                { status: "DELIVERED", note: "Courier reported delivery" },
                // No actor, deliberately. No human performed this, and
                // `OrderStatusHistory.changedById` is a nullable FK to User — a
                // sentinel like "system" would fail that constraint on write,
                // and naming a real user would be a lie.
                undefined,
            );
        } catch (error) {
            // An order already DELIVERED, or one the transition map refuses from
            // its current state, lands here. The shipment is correct either way.
            console.warn(
                `Courier reported delivery for order ${shipment.orderId} but the status advance failed:`,
                error instanceof Error ? error.message : error,
            );
        }
    }
};

/** Builds the replay-proof key for one notification. See design.md Decision 11. */
const buildDedupeKey = (
    shipmentId: string,
    payload: ICourierWebhookPayload,
): string =>
    [
        shipmentId,
        payload.notification_type,
        payload.updated_at ?? "",
        payload.status ?? "",
        (payload.tracking_message ?? "").slice(0, 120),
    ].join("|");

const toDecimal = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Handles one webhook notification.
 *
 * An unknown consignment is acknowledged rather than refused: Steadfast is not
 * at fault for a consignment we no longer hold, and answering with an error
 * would invite retries of something that can never succeed.
 */
const handleWebhook = async (payload: ICourierWebhookPayload) => {
    const consignmentId = String(payload.consignment_id);

    const shipment = await prisma.shipment.findUnique({
        where: { consignmentId },
        select: { id: true, orderId: true, courierStatus: true },
    });

    if (!shipment) {
        console.warn(
            `Courier webhook named consignment ${consignmentId}, which this system does not hold. Acknowledged and ignored.`,
        );
        return { matched: false };
    }

    const courierUpdatedAt = payload.updated_at ? new Date(payload.updated_at) : null;
    const observedAt =
        courierUpdatedAt && !Number.isNaN(courierUpdatedAt.getTime())
            ? courierUpdatedAt
            : new Date();

    /*
     * History first, and let the unique constraint do the deduplicating. A
     * read-then-write check would let two concurrent deliveries of the same
     * notification both pass, appending twice.
     */
    try {
        await prisma.courierTrackingEvent.create({
            data: {
                shipmentId: shipment.id,
                notificationType: String(payload.notification_type),
                status: payload.status ? normaliseCourierStatus(payload.status) : null,
                trackingMessage: payload.tracking_message ?? null,
                codAmount: toDecimal(payload.cod_amount),
                deliveryCharge: toDecimal(payload.delivery_charge),
                courierUpdatedAt:
                    courierUpdatedAt && !Number.isNaN(courierUpdatedAt.getTime())
                        ? courierUpdatedAt
                        : null,
                dedupeKey: buildDedupeKey(shipment.id, payload),
            },
        });
    } catch (error) {
        // P2002 — a replay. Expected, and exactly what the constraint is for.
        const code = (error as { code?: string }).code;
        if (code !== "P2002") throw error;

        return { matched: true, duplicate: true };
    }

    if (payload.status) {
        await applyCourierStatus(shipment, payload.status, observedAt);
    }

    return { matched: true, duplicate: false };
};

/**
 * Polls the consignments that have gone quiet.
 *
 * Not a refresh of everything: a webhook is one delivery attempt with no
 * promised retry, and this job exists to notice when one was missed. So it looks
 * for silence — non-terminal consignments nothing has been heard about inside
 * the staleness window. See design.md Decision 7.
 */
const reconcileQuietConsignments = async () => {
    assertConfigured();

    const cutoff = new Date(Date.now() - STALENESS_MINUTES * 60 * 1000);

    const stale = await prisma.shipment.findMany({
        where: {
            consignmentId: { not: null },
            OR: [{ courierSyncedAt: null }, { courierSyncedAt: { lt: cutoff } }],
            NOT: { courierStatus: { in: ["delivered", "partial_delivered", "cancelled"] } },
        },
        select: { id: true, orderId: true, consignmentId: true, courierStatus: true },
        orderBy: { courierSyncedAt: "asc" },
        take: RECONCILE_BATCH,
    });

    let checked = 0;
    let updated = 0;
    let failed = 0;

    // Sequential, not parallel: Steadfast documents no rate limit, and a fan-out
    // against an undocumented limit is how one gets a limit imposed.
    for (const shipment of stale) {
        checked += 1;

        const response = await SteadfastClient.getStatusByConsignmentId(
            shipment.consignmentId as string,
        );

        if (response.outcome !== "ok") {
            // Left untouched. A courier outage must not be written into the
            // record as a delivery state.
            failed += 1;
            console.warn(
                `Reconciliation could not read consignment ${shipment.consignmentId}: ${response.message}`,
            );
            continue;
        }

        const reported = response.data?.delivery_status;
        if (!reported) continue;

        const before = shipment.courierStatus;
        await applyCourierStatus(shipment, reported, new Date());

        if (normaliseCourierStatus(before ?? "") !== normaliseCourierStatus(reported)) {
            updated += 1;
        }
    }

    return { checked, updated, failed, remaining: stale.length === RECONCILE_BATCH };
};

const getBalance = async () => {
    assertConfigured();

    const response = await SteadfastClient.getBalance();

    if (response.outcome !== "ok") {
        throw new AppError(
            status.BAD_GATEWAY,
            `Could not read the courier balance: ${response.message}`,
        );
    }

    return { currentBalance: response.data.current_balance };
};

const createReturnRequest = async (orderId: string, reason: string | undefined) => {
    assertConfigured();

    const shipment = await prisma.shipment.findFirst({
        where: { orderId, consignmentId: { not: null } },
        orderBy: { createdAt: "desc" },
    });

    if (!shipment) {
        throw new AppError(
            status.BAD_REQUEST,
            "This order has not been dispatched to the courier, so there is no consignment to return.",
        );
    }

    const response = await SteadfastClient.createReturnRequest(
        shipment.consignmentId as string,
        reason,
    );

    if (response.outcome !== "ok") {
        throw new AppError(
            status.BAD_GATEWAY,
            `The courier did not accept the return request: ${response.message}`,
        );
    }

    return response.data;
};

/** Whether the webhook token is set, without disclosing it. */
const isWebhookConfigured = (): boolean => Boolean(envVars.STEADFAST_WEBHOOK_TOKEN);

export const CourierService = {
    previewDispatch,
    dispatchOrders,
    handleWebhook,
    reconcileQuietConsignments,
    getBalance,
    createReturnRequest,
    isWebhookConfigured,
    isConfigured: SteadfastClient.isCourierConfigured,
    // Exported for the verification scripts, which exercise them without calling
    // Steadfast.
    _internals: { evaluateOrder, buildDedupeKey, applyCourierStatus, isTerminalCourierStatus, needsAttention },
};

export { CourierNotConfiguredError };
