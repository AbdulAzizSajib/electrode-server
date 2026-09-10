/**
 * Courier dispatch and status, across whichever courier the shop uses.
 *
 * THIS FILE ORCHESTRATES; PROVIDERS TRANSLATE. Everything here is
 * courier-independent by design — deduplicating a selection, eligibility
 * ordering, batching with results persisted before the next batch is sent,
 * matching results by invoice rather than array position, and the single
 * `applyCourierStatus` both status paths converge on. Each of those exists
 * because getting it wrong duplicates a consignment or corrupts a status, so
 * none of them is delegated to a provider that could then reintroduce the
 * failure. See `courier.provider.ts`.
 *
 * ROUTING FOLLOWS THE CONSIGNMENT, NOT THE SETTING. Only dispatch reads
 * `StoreSetting.courierProvider`; reconciliation, webhooks and returns all route
 * on the `Shipment.courierProvider` recorded when the consignment was created.
 * Without that, changing the setting would strand every parcel in flight — the
 * sync job polling a new courier for an id it never issued.
 *
 * See openspec/changes/add-steadfast-courier-integration and
 * openspec/changes/add-courier-provider-selection, design.md Decisions 2 and 3.
 */
import status from "http-status";
import {
    AuditAction,
    CourierProvider,
    OrderStatus,
    ShipmentStatus,
} from "../../../generated/prisma/client";
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
} from "./courier.interface";
import {
    ICourierConsignmentResult,
    ICourierProvider,
    ICourierStatusReading,
    ICourierWebhookReading,
} from "./courier.provider";
import { listProviders, resolveProvider } from "./providers";

/**
 * How many consignments one courier request carries.
 *
 * Steadfast allows 500. We send 50, because the binding constraint is not their
 * limit but our 30-second Vercel function: a 500-item call plus its database
 * writes will not finish, and a dispatch that dies after the courier has
 * committed is the exact failure this module exists to prevent.
 * See add-steadfast-courier-integration design.md Decision 4.
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

/**
 * Courier statuses meaning "nothing further will happen".
 *
 * Used for two things that must agree: which consignments reconciliation stops
 * polling, and which no longer block a provider switch. `unknown` is
 * deliberately absent — it is the courier telling us to contact support, which
 * is the opposite of settled.
 */
const TERMINAL_COURIER_STATUSES = ["delivered", "partial_delivered", "cancelled"];

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

/**
 * The provider the shop dispatches through right now.
 *
 * Read at dispatch time rather than cached: a setting read from a module-level
 * variable would serve a stale provider to every request in a warm function
 * until it was redeployed.
 */
const getConfiguredProvider = async (): Promise<ICourierProvider> => {
    const setting = await prisma.storeSetting.findUnique({
        where: { id: "singleton" },
        select: { courierProvider: true },
    });

    // No settings row yet means a shop that has never been configured. The
    // schema default is STEADFAST and so is this, so the two cannot disagree.
    return resolveProvider(setting?.courierProvider ?? CourierProvider.STEADFAST);
};

/**
 * Refuses an action the provider does not offer.
 *
 * Enforced here as well as hidden in the admin. Hiding alone leaves an endpoint
 * that fails confusingly when called directly; refusing alone leaves buttons
 * that exist only to fail. See design.md Decision 7.
 */
const assertCapability = (
    provider: ICourierProvider,
    capability: keyof ICourierProvider["capabilities"],
    action: string,
) => {
    if (!provider.capabilities[capability]) {
        throw new AppError(
            status.BAD_REQUEST,
            `${provider.displayName} does not support ${action}.`,
        );
    }
};

/** Refuses a provider whose credentials are unset, naming it. */
const assertConfigured = (provider: ICourierProvider) => {
    if (!provider.isConfigured()) {
        throw new AppError(
            status.SERVICE_UNAVAILABLE,
            `${provider.displayName} is selected but not configured. Set its API credentials in the environment.`,
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
const evaluateOrder = (
    order: ICourierOrderForDispatch,
    provider: ICourierProvider,
): ICourierEligibility => {
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

    // Provider-specific from here: field limits, phone format and address
    // composition are the courier's, and the refusal names the courier's rule.
    const mapped = provider.mapOrder(order);

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
    const provider = await getConfiguredProvider();

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

        return evaluateOrder(order as unknown as ICourierOrderForDispatch, provider);
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
    provider: ICourierProvider,
    consignmentId: string,
    trackingCode: string | null,
    actorUserId: string,
) => {
    const existing = order.shipments[0];

    const data = {
        // Recorded per consignment, never read back from the setting: this
        // parcel stays bound to the courier carrying it however the shop is
        // later reconfigured. See design.md Decision 3.
        courierProvider: provider.id,
        consignmentId,
        courierInvoice: order.orderNumber,
        courierStatus: "in_review",
        courierSyncedAt: new Date(),
        carrier: provider.displayName,
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
     * Failure here is logged, not thrown: the consignment exists at the courier
     * and the shipment row is already written. Losing the status advance is a
     * cosmetic inconsistency an operator can fix; throwing would abandon the
     * rest of the batch over it.
     */
    try {
        await OrderService.updateOrderStatus(
            order.id,
            {
                status: "SHIPPED",
                note: `Dispatched to ${provider.displayName} (consignment ${consignmentId})`,
            },
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
 * Sends the eligible orders to the configured provider in bounded batches.
 *
 * Each batch is persisted before the next is sent. This is the property that
 * makes a timeout recoverable: a request killed at Vercel's ceiling then loses
 * the RESPONSE, not the RECORD, so the operator refreshes and sees precisely
 * which orders went. Accumulating results and writing once at the end would turn
 * a timeout into an unrecoverable divergence between our database and the
 * courier's. See add-steadfast-courier-integration design.md Decision 4.
 */
const dispatchOrders = async (
    orderIds: string[],
    actor: ICourierActor,
): Promise<ICourierDispatchSummary> => {
    const provider = await getConfiguredProvider();

    assertCapability(provider, "dispatch", "dispatching orders");
    assertConfigured(provider);

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

        const requests = [];
        const byInvoice = new Map<string, (typeof batch)[number]>();

        for (const order of batch) {
            const mapped = provider.mapOrder(order as unknown as ICourierOrderForDispatch);

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

            requests.push(mapped.request);
            byInvoice.set(mapped.request.invoice, order);
        }

        if (requests.length === 0) continue;

        const response = await provider.createConsignments!(requests);

        if (response.outcome === "unconfirmed") {
            /*
             * NOT a failure. Aborting our request does not abort the courier's
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
                `${provider.displayName} returned invoice "${invoice}", which was not in the batch sent. Skipped.`,
            );
        }

        for (const item of matched.accepted) {
            const order = byInvoice.get(item.invoice)!;

            await recordDispatchedConsignment(
                order,
                provider,
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

        for (const rejected of matched.rejected) {
            const order = byInvoice.get(rejected.invoice)!;

            results.push({
                orderId: order.id,
                orderNumber: order.orderNumber,
                outcome: "failed",
                detail: rejected.message ?? "The courier rejected this consignment.",
            });
        }

        // Sent but absent from the response. We cannot say it failed, because we
        // cannot say the courier did not create it.
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
            provider: provider.id,
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
 * Pure and separate so the property that matters can be verified without calling
 * a courier: nothing promises the response array is ordered like the request,
 * and applying it positionally would write one order's consignment id onto
 * another — a wrong tracking number handed to a customer and a parcel nobody can
 * find. See add-steadfast-courier-integration design.md Decision 5.
 *
 * Returns three groups, because "not in the response" is not the same as
 * "rejected": an invoice we sent and did not hear about may still have been
 * created, so it is unconfirmed rather than failed.
 */
export const matchResultsByInvoice = (
    sentInvoices: string[],
    responseItems: ICourierConsignmentResult[],
) => {
    const sent = new Set(sentInvoices);
    const accepted: { invoice: string; consignmentId: string; trackingCode: string | null }[] = [];
    const rejected: { invoice: string; message?: string }[] = [];
    const unknownInvoices: string[] = [];
    const seen = new Set<string>();

    for (const item of responseItems) {
        if (!sent.has(item.invoice)) {
            unknownInvoices.push(item.invoice);
            continue;
        }

        seen.add(item.invoice);

        // The provider has already translated its courier's own success flag
        // into `accepted`; this function does not parse courier status strings.
        if (item.accepted && item.consignmentId) {
            accepted.push({
                invoice: item.invoice,
                consignmentId: item.consignmentId,
                trackingCode: item.trackingCode,
            });
        } else {
            rejected.push({ invoice: item.invoice, message: item.message });
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
 * how a panel comes to disagree with itself. See
 * add-steadfast-courier-integration design.md Decision 7.
 *
 * Idempotent: applying a status the shipment already holds touches only
 * `courierSyncedAt`, which is what makes a re-delivered webhook and a
 * double-fired cron equally harmless.
 *
 * Takes a `reading` rather than a raw string, because what a status MEANS is the
 * provider's to say — its vocabulary, its terminal set, its notion of a partial
 * delivery.
 */
const applyCourierStatus = async (
    shipment: { id: string; orderId: string; courierStatus: string | null },
    reading: ICourierStatusReading,
    observedAt: Date,
) => {
    const unchanged = (shipment.courierStatus ?? "").trim().toLowerCase() === reading.rawStatus;

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
            courierStatus: reading.rawStatus,
            courierSyncedAt: observedAt,
            status: reading.shipmentStatus,
            ...(reading.isFullyDelivered ? { deliveredAt: observedAt } : {}),
        },
    });

    /*
     * Only a full delivery advances the order. A partial one does not: closing
     * an order while goods are still coming back states something untrue about
     * where they are. This used to be near-unrecoverable, since DELIVERED
     * offered no transition back; transitions are unrestricted now, so staff
     * CAN walk it back — but a wrong status the courier wrote itself is one
     * nobody knows to go and correct, so the restraint still stands.
     *
     * A cancellation deliberately does nothing here — not the order status, not
     * stock, not a refund. The parcel is on its way back, and restocking on the
     * courier's signal would advertise goods the shop does not hold. The order
     * surfaces as needing attention instead, and staff resolve it through the
     * existing cancellation flow.
     */
    if (reading.isFullyDelivered) {
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
            // An order already DELIVERED lands here — since transitions became
            // unrestricted that is effectively the only case, the no-op guard
            // being all that remains. The shipment is correct either way.
            console.warn(
                `Courier reported delivery for order ${shipment.orderId} but the status advance failed:`,
                error instanceof Error ? error.message : error,
            );
        }
    }
};

/** Builds the replay-proof key for one notification. See
 *  add-steadfast-courier-integration design.md Decision 11. */
const buildDedupeKey = (shipmentId: string, reading: ICourierWebhookReading): string =>
    [
        shipmentId,
        reading.notificationType,
        reading.courierUpdatedAt?.toISOString() ?? "",
        reading.rawStatus ?? "",
        (reading.trackingMessage ?? "").slice(0, 120),
    ].join("|");

/**
 * Handles one webhook notification from a named provider.
 *
 * An unknown consignment is acknowledged rather than refused: the courier is not
 * at fault for a consignment we no longer hold, and answering with an error
 * would invite retries of something that can never succeed.
 *
 * A consignment belonging to a DIFFERENT provider is a distinct case and is
 * rejected. Two couriers issue ids from their own spaces, so matching on the id
 * alone would let one courier's status be written onto another's parcel.
 */
const handleWebhook = async (provider: ICourierProvider, body: unknown) => {
    const reading = provider.parseWebhook?.(body);

    if (!reading) {
        return { matched: false, reason: "unreadable" as const };
    }

    const shipment = await prisma.shipment.findUnique({
        where: {
            courierProvider_consignmentId: {
                courierProvider: provider.id,
                consignmentId: reading.consignmentId,
            },
        },
        select: { id: true, orderId: true, courierStatus: true },
    });

    if (!shipment) {
        // Deliberately does not distinguish "no such consignment anywhere" from
        // "belongs to another provider" in the response. Both are acknowledged
        // and neither writes anything; telling an unauthenticated-ish caller
        // which consignment ids exist under which provider would be an
        // enumeration oracle. The log line carries the detail.
        const elsewhere = await prisma.shipment.findFirst({
            where: { consignmentId: reading.consignmentId },
            select: { courierProvider: true },
        });

        if (elsewhere) {
            console.warn(
                `${provider.displayName} webhook named consignment ${reading.consignmentId}, which belongs to ${elsewhere.courierProvider}. Ignored.`,
            );
            return { matched: false, reason: "wrong-provider" as const };
        }

        console.warn(
            `${provider.displayName} webhook named consignment ${reading.consignmentId}, which this system does not hold. Acknowledged and ignored.`,
        );
        return { matched: false, reason: "unknown-consignment" as const };
    }

    const observedAt = reading.courierUpdatedAt ?? new Date();

    /*
     * History first, and let the unique constraint do the deduplicating. A
     * read-then-write check would let two concurrent deliveries of the same
     * notification both pass, appending twice.
     */
    try {
        await prisma.courierTrackingEvent.create({
            data: {
                shipmentId: shipment.id,
                notificationType: reading.notificationType,
                status: reading.rawStatus ? reading.rawStatus.trim().toLowerCase() : null,
                trackingMessage: reading.trackingMessage ?? null,
                codAmount: reading.codAmount,
                deliveryCharge: reading.deliveryCharge,
                courierUpdatedAt: reading.courierUpdatedAt ?? null,
                dedupeKey: buildDedupeKey(shipment.id, reading),
            },
        });
    } catch (error) {
        // P2002 — a replay. Expected, and exactly what the constraint is for.
        const code = (error as { code?: string }).code;
        if (code !== "P2002") throw error;

        return { matched: true, duplicate: true };
    }

    if (reading.rawStatus) {
        // Asked of the provider rather than derived here: the vocabulary is
        // theirs, and only they can say whether their string means delivered.
        const interpreted = provider.readStatus
            ? provider.readStatus(reading.rawStatus)
            : undefined;

        if (interpreted) {
            await applyCourierStatus(shipment, interpreted, observedAt);
        }
    }

    return { matched: true, duplicate: false };
};

/**
 * Polls the consignments that have gone quiet.
 *
 * Not a refresh of everything: a webhook is one delivery attempt with no
 * promised retry, and this job exists to notice when one was missed. So it looks
 * for silence — non-terminal consignments nothing has been heard about inside
 * the staleness window. See add-steadfast-courier-integration design.md
 * Decision 7.
 *
 * Each consignment is polled against THE PROVIDER THAT CREATED IT, not the one
 * currently configured. That is what lets parcels from a previously selected
 * courier keep settling after the merchant switches.
 */
const reconcileQuietConsignments = async () => {
    const cutoff = new Date(Date.now() - STALENESS_MINUTES * 60 * 1000);

    const stale = await prisma.shipment.findMany({
        where: {
            consignmentId: { not: null },
            OR: [{ courierSyncedAt: null }, { courierSyncedAt: { lt: cutoff } }],
            NOT: { courierStatus: { in: TERMINAL_COURIER_STATUSES } },
        },
        select: {
            id: true,
            orderId: true,
            consignmentId: true,
            courierProvider: true,
            courierStatus: true,
        },
        orderBy: { courierSyncedAt: "asc" },
        take: RECONCILE_BATCH,
    });

    let checked = 0;
    let updated = 0;
    let failed = 0;
    let unreconcilable = 0;

    // Sequential, not parallel: couriers document no rate limit, and a fan-out
    // against an undocumented limit is how one gets a limit imposed.
    for (const shipment of stale) {
        checked += 1;

        const provider = resolveProvider(shipment.courierProvider);

        /*
         * Reported, not silently skipped. A consignment whose creating provider
         * can no longer be reached will never settle on its own, and a job that
         * quietly passes over it looks identical to one finding nothing wrong.
         */
        if (!provider.capabilities.status || !provider.isConfigured()) {
            unreconcilable += 1;
            console.warn(
                `Consignment ${shipment.consignmentId} cannot be reconciled: ${provider.displayName} ${
                    provider.capabilities.status ? "has no usable credentials" : "cannot be polled for status"
                }.`,
            );
            continue;
        }

        const response = await provider.getStatus!(shipment.consignmentId as string);

        if (response.outcome !== "ok") {
            // Left untouched. A courier outage must not be written into the
            // record as a delivery state.
            failed += 1;
            console.warn(
                `Reconciliation could not read consignment ${shipment.consignmentId} from ${provider.displayName}: ${response.message}`,
            );
            continue;
        }

        const before = (shipment.courierStatus ?? "").trim().toLowerCase();
        await applyCourierStatus(shipment, response.data, new Date());

        if (before !== response.data.rawStatus) {
            updated += 1;
        }
    }

    return {
        checked,
        updated,
        failed,
        unreconcilable,
        remaining: stale.length === RECONCILE_BATCH,
    };
};

const getBalance = async () => {
    const provider = await getConfiguredProvider();

    assertCapability(provider, "balance", "balance enquiries");
    assertConfigured(provider);

    const response = await provider.getBalance!();

    if (response.outcome !== "ok") {
        throw new AppError(
            status.BAD_GATEWAY,
            `Could not read the ${provider.displayName} balance: ${response.message}`,
        );
    }

    return response.data;
};

/**
 * Raises a return with the provider that created the consignment.
 *
 * Routed on the shipment's own provider, not the configured one: a parcel
 * dispatched through one courier must be returned through that same courier
 * however the shop is now set up.
 */
const createReturnRequest = async (orderId: string, reason: string | undefined) => {
    const shipment = await prisma.shipment.findFirst({
        where: { orderId, consignmentId: { not: null } },
        orderBy: { createdAt: "desc" },
    });

    if (!shipment) {
        throw new AppError(
            status.BAD_REQUEST,
            "This order has not been dispatched to a courier, so there is no consignment to return.",
        );
    }

    const provider = resolveProvider(shipment.courierProvider);

    assertCapability(provider, "returns", "return requests");
    assertConfigured(provider);

    const response = await provider.createReturnRequest!(
        shipment.consignmentId as string,
        reason,
    );

    if (response.outcome !== "ok") {
        throw new AppError(
            status.BAD_GATEWAY,
            `${provider.displayName} did not accept the return request: ${response.message}`,
        );
    }

    return response.data;
};

/**
 * What the admin needs to render the courier surface honestly.
 *
 * Derived state about the environment and the registry, not a stored setting —
 * which is why it is served from here rather than round-tripping through the
 * writable settings row. Reports only WHETHER each credential is present, never
 * its value.
 */
const getProviderConfiguration = async () => {
    const configured = await getConfiguredProvider();

    return {
        configured: configured.id,
        providers: listProviders().map((provider) => ({
            id: provider.id,
            displayName: provider.displayName,
            capabilities: provider.capabilities,
            credentialsConfigured: provider.isConfigured(),
            webhookConfigured: provider.isWebhookConfigured(),
        })),
    };
};

/**
 * How many consignments the given provider still has in flight.
 *
 * Used by the settings service to refuse a provider switch that would strand
 * them, and by the admin to say how many. "Not terminal" is the same set
 * reconciliation polls, so the two cannot disagree about what "in flight" means.
 */
const countInFlightConsignments = (provider: CourierProvider) =>
    prisma.shipment.count({
        where: {
            courierProvider: provider,
            consignmentId: { not: null },
            OR: [
                { courierStatus: null },
                { NOT: { courierStatus: { in: TERMINAL_COURIER_STATUSES } } },
            ],
        },
    });

export const CourierService = {
    previewDispatch,
    dispatchOrders,
    handleWebhook,
    reconcileQuietConsignments,
    getBalance,
    createReturnRequest,
    getProviderConfiguration,
    countInFlightConsignments,
    getConfiguredProvider,
    // Exported for the verification scripts, which exercise them without calling
    // a courier.
    _internals: {
        evaluateOrder,
        buildDedupeKey,
        applyCourierStatus,
        assertCapability,
        TERMINAL_COURIER_STATUSES,
    },
};
