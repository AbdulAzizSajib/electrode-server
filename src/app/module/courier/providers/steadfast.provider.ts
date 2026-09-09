/**
 * Steadfast Courier, behind the provider interface.
 *
 * A THIN ADAPTER OVER `steadfast.client.ts`, WHICH IS UNCHANGED. The client
 * still owns the HTTP: its three-way `ok` / `failed` / `unconfirmed` result, its
 * defensive bulk-response parsing, its 15-second ceiling. This file only
 * translates between that and the provider interface, so the behaviour verified
 * by the existing courier scripts is the behaviour that still runs.
 *
 * What lives here rather than in the service is everything Steadfast-specific:
 * its field limits and address composition (via `courier.mapper.ts`) and its
 * eleven-value status vocabulary (via `courier.status.ts`). Both of those files
 * were always Steadfast's, and they move behind this boundary without their
 * contents changing.
 *
 * See openspec/changes/add-courier-provider-selection, design.md Decisions 1
 * and 2.
 */
import { CourierProvider } from "../../../../generated/prisma/client";
import { envVars } from "../../../config/env";
import { ICourierOrderForDispatch } from "../courier.interface";
import { mapOrderToConsignment } from "../courier.mapper";
import {
    CourierMapResult,
    CourierResult,
    ICourierCapabilities,
    ICourierConsignmentRequest,
    ICourierConsignmentResult,
    ICourierProvider,
    ICourierReturnResult,
    ICourierStatusReading,
    ICourierWebhookReading,
} from "../courier.provider";
import {
    isFullyDelivered,
    isTerminalCourierStatus,
    needsAttention,
    normaliseCourierStatus,
    toShipmentStatus,
} from "../courier.status";
import {
    SteadfastClient,
    SteadfastOrderPayload,
} from "../steadfast.client";

/** Steadfast supports everything the interface offers. */
const CAPABILITIES: ICourierCapabilities = {
    dispatch: true,
    status: true,
    balance: true,
    returns: true,
    webhook: true,
};

/** Reads one number out of a webhook payload without letting a junk value
 *  through as NaN. */
const toNumber = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

/** Everything the service needs to know about one Steadfast status string. */
const readStatus = (raw: string): ICourierStatusReading => ({
    rawStatus: normaliseCourierStatus(raw),
    shipmentStatus: toShipmentStatus(raw),
    isFullyDelivered: isFullyDelivered(raw),
    isTerminal: isTerminalCourierStatus(raw),
    needsAttention: needsAttention(raw),
});

const mapOrder = (order: ICourierOrderForDispatch): CourierMapResult => {
    const mapped = mapOrderToConsignment(order);

    if (!mapped.ok) {
        return { ok: false, reason: mapped.reason, detail: mapped.detail };
    }

    return {
        ok: true,
        request: { invoice: mapped.payload.invoice, payload: mapped.payload },
    };
};

/**
 * Sends one batch.
 *
 * The per-item `status` field is Steadfast's own success flag, and translating
 * it into the interface's `accepted` boolean is exactly the kind of thing that
 * belongs in an adapter: the service must not be parsing another company's
 * status strings.
 */
const createConsignments = async (
    requests: ICourierConsignmentRequest[],
): Promise<CourierResult<ICourierConsignmentResult[]>> => {
    const payloads = requests.map((request) => request.payload as SteadfastOrderPayload);

    const response = await SteadfastClient.createBulkOrders(payloads);

    if (response.outcome !== "ok") return response;

    return {
        outcome: "ok",
        data: response.data.map((item) => ({
            invoice: item.invoice,
            consignmentId: item.consignment_id != null ? String(item.consignment_id) : null,
            trackingCode: item.tracking_code ?? null,
            accepted:
                normaliseCourierStatus(String(item.status ?? "")) === "success" &&
                item.consignment_id != null,
        })),
    };
};

const getStatus = async (
    consignmentId: string,
): Promise<CourierResult<ICourierStatusReading>> => {
    const response = await SteadfastClient.getStatusByConsignmentId(consignmentId);

    if (response.outcome !== "ok") return response;

    const reported = response.data?.delivery_status;

    // Answered, but with nothing usable. Reported as failed rather than ok with
    // an empty status: the service must not write a blank status over a real
    // one, and `failed` is truthful here — we reached them and got no answer to
    // the question asked.
    if (!reported) {
        return {
            outcome: "failed",
            status: 200,
            message: "The courier returned no delivery status for this consignment.",
        };
    }

    return { outcome: "ok", data: readStatus(reported) };
};

const getBalance = async (): Promise<CourierResult<{ currentBalance: number }>> => {
    const response = await SteadfastClient.getBalance();

    if (response.outcome !== "ok") return response;

    return { outcome: "ok", data: { currentBalance: response.data.current_balance } };
};

const createReturnRequest = async (
    consignmentId: string,
    reason?: string,
): Promise<CourierResult<ICourierReturnResult>> => {
    const response = await SteadfastClient.createReturnRequest(consignmentId, reason);

    if (response.outcome !== "ok") return response;

    return {
        outcome: "ok",
        data: {
            ...response.data,
            id: response.data.id,
            status: response.data.status,
        },
    };
};

/**
 * Reads one webhook body.
 *
 * Steadfast sends two notification types — `delivery_status` and
 * `tracking_update` — and only the first carries a status. A body without a
 * consignment id is unusable and returns null rather than a half-built reading;
 * the route rejects it.
 */
const parseWebhook = (body: unknown): ICourierWebhookReading | null => {
    if (!body || typeof body !== "object") return null;

    const payload = body as Record<string, unknown>;

    if (payload.consignment_id === undefined || payload.consignment_id === null) return null;

    const rawUpdatedAt =
        typeof payload.updated_at === "string" ? new Date(payload.updated_at) : null;

    return {
        consignmentId: String(payload.consignment_id),
        notificationType: String(payload.notification_type ?? ""),
        rawStatus: payload.status ? String(payload.status) : undefined,
        trackingMessage:
            typeof payload.tracking_message === "string" ? payload.tracking_message : undefined,
        codAmount: toNumber(payload.cod_amount),
        deliveryCharge: toNumber(payload.delivery_charge),
        courierUpdatedAt:
            rawUpdatedAt && !Number.isNaN(rawUpdatedAt.getTime()) ? rawUpdatedAt : undefined,
    };
};

export const SteadfastProvider: ICourierProvider = {
    id: CourierProvider.STEADFAST,
    displayName: "Steadfast",
    capabilities: CAPABILITIES,
    isConfigured: () => SteadfastClient.isCourierConfigured(),
    isWebhookConfigured: () => Boolean(envVars.STEADFAST_WEBHOOK_TOKEN),
    webhookToken: () => envVars.STEADFAST_WEBHOOK_TOKEN,
    mapOrder,
    createConsignments,
    getStatus,
    readStatus,
    getBalance,
    createReturnRequest,
    parseWebhook,
};
