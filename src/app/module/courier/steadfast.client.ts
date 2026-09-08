/**
 * The Steadfast Courier HTTP client.
 *
 * Every call returns a discriminated result rather than throwing, because the
 * three ways a courier call can end are genuinely different and collapsing them
 * is how a merchant pays for two pickups of one parcel:
 *
 *  - `ok`          — Steadfast answered and we understood it.
 *  - `failed`      — we reached Steadfast and it rejected us. Nothing was
 *                    created, so retrying is safe.
 *  - `unconfirmed` — the request timed out or the response was unreadable.
 *                    Aborting our fetch does NOT abort Steadfast's handler, so
 *                    the consignments may well exist and we simply do not know.
 *                    Retrying is NOT safe.
 *
 * The storefront already draws this exact distinction for the same reason — see
 * `frontend/src/lib/api-proxy.ts`, which returns 504 `timedOut` for a checkout
 * that may have committed and 503 for one that certainly did not.
 * See openspec/changes/add-steadfast-courier-integration, design.md Decision 6.
 */
import { STEADFAST_DEFAULT_BASE_URL, envVars } from "../../config/env";

/** Per-call ceiling. The dispatch path sits inside Vercel's 30s function limit. */
const TIMEOUT_MS = 15_000;

/** Thrown when the credentials are unset, so callers report "not configured"
 *  rather than surfacing a 401 that reads like a wrong key. */
export class CourierNotConfiguredError extends Error {
    constructor() {
        super(
            "Steadfast is not configured. Set STEADFAST_API_KEY and STEADFAST_SECRET_KEY.",
        );
        this.name = "CourierNotConfiguredError";
    }
}

export type CourierResult<T> =
    | { outcome: "ok"; data: T }
    | { outcome: "failed"; status: number; message: string }
    | { outcome: "unconfirmed"; message: string };

/** Whether the credentials are present, without disclosing them. */
export const isCourierConfigured = (): boolean =>
    Boolean(envVars.STEADFAST_API_KEY && envVars.STEADFAST_SECRET_KEY);

const baseUrl = () =>
    (envVars.STEADFAST_BASE_URL || STEADFAST_DEFAULT_BASE_URL).replace(/\/$/, "");

/**
 * Steadfast's three required headers. Their documentation capitalises them
 * `Api-Key` / `Secret-Key`; HTTP header names are case-insensitive, but they are
 * written as documented so a reader comparing the two sees the same strings.
 */
const headers = (): Record<string, string> => {
    if (!isCourierConfigured()) throw new CourierNotConfiguredError();

    return {
        "Api-Key": envVars.STEADFAST_API_KEY as string,
        "Secret-Key": envVars.STEADFAST_SECRET_KEY as string,
        "Content-Type": "application/json",
    };
};

const request = async <T>(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<CourierResult<T>> => {
    const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

    let response: Response;
    try {
        response = await fetch(url, {
            method: init.method,
            headers: headers(),
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (error) {
        // A timeout is NOT an unreachable server. On a timeout Steadfast has
        // already received the request and runs to completion, so anything it
        // was asked to create may exist. Saying "couldn't reach the courier,
        // try again" invites the retry that duplicates it.
        if (error instanceof Error && error.name === "TimeoutError") {
            return {
                outcome: "unconfirmed",
                message:
                    "The courier did not respond in time, so the outcome is unknown. The consignments may have been created — check before retrying.",
            };
        }

        // Nothing was delivered, so retrying really is safe here.
        return {
            outcome: "failed",
            status: 0,
            message: "Unable to reach the courier. Please try again.",
        };
    }

    const text = await response.text().catch(() => "");

    let payload: unknown = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            // A 2xx we cannot parse is the dangerous case: Steadfast may have
            // acted on the request and we have no way to read what it did.
            if (response.ok) {
                return {
                    outcome: "unconfirmed",
                    message:
                        "The courier's response could not be read, so the outcome is unknown. Check before retrying.",
                };
            }
            return {
                outcome: "failed",
                status: response.status,
                message: `Courier request failed (${response.status})`,
            };
        }
    }

    if (!response.ok) {
        return {
            outcome: "failed",
            status: response.status,
            message: extractMessage(payload, `Courier request failed (${response.status})`),
        };
    }

    return { outcome: "ok", data: payload as T };
};

/** Steadfast reports errors as `message`, and validation failures as `errors`. */
const extractMessage = (payload: unknown, fallback: string): string => {
    if (!payload || typeof payload !== "object") return fallback;

    const body = payload as { message?: unknown; errors?: unknown };

    if (typeof body.message === "string" && body.message.length > 0) {
        return body.message;
    }

    if (body.errors && typeof body.errors === "object") {
        const first = Object.values(body.errors as Record<string, unknown>)[0];
        if (Array.isArray(first) && typeof first[0] === "string") return first[0];
        if (typeof first === "string") return first;
    }

    return fallback;
};

/** One consignment as sent to Steadfast. The bulk endpoint accepts no
 *  `delivery_type`, so every consignment is its default home delivery. */
export interface SteadfastOrderPayload {
    invoice: string;
    recipient_name: string;
    recipient_phone: string;
    recipient_address: string;
    cod_amount: number;
    note?: string;
}

/** One row of the bulk response. `status` is Steadfast's own success/error flag. */
export interface SteadfastBulkResultItem {
    invoice: string;
    consignment_id: number | null;
    tracking_code: string | null;
    status: string;
    [key: string]: unknown;
}

/**
 * Pulls the per-item array out of a bulk response.
 *
 * Written defensively because the documented shape is ambiguous: the response is
 * described as an array of per-item objects, but a wholly rejected batch may
 * instead return a top-level error envelope with no array at all. Both are
 * handled here rather than at the call site, and anything unrecognised is
 * reported as unconfirmed — the batch was accepted for processing and we cannot
 * read what happened to it, which is precisely not a failure.
 * See design.md — Open Questions.
 */
const parseBulkResponse = (
    data: unknown,
): CourierResult<SteadfastBulkResultItem[]> => {
    if (Array.isArray(data)) {
        return { outcome: "ok", data: data as SteadfastBulkResultItem[] };
    }

    if (data && typeof data === "object") {
        const body = data as Record<string, unknown>;

        // The documented envelope nests the rows under `data`; some responses
        // have been seen to use `consignments`. Accept either.
        for (const key of ["data", "consignments", "result"]) {
            if (Array.isArray(body[key])) {
                return {
                    outcome: "ok",
                    data: body[key] as SteadfastBulkResultItem[],
                };
            }
        }

        // A top-level error envelope with no rows: Steadfast rejected the whole
        // batch outright, so nothing was created and a retry is safe.
        if (typeof body.message === "string" || body.errors) {
            return {
                outcome: "failed",
                status: typeof body.status === "number" ? body.status : 400,
                message: extractMessage(body, "The courier rejected the batch."),
            };
        }
    }

    return {
        outcome: "unconfirmed",
        message:
            "The courier returned a response we could not interpret, so the outcome is unknown. Check before retrying.",
    };
};

const createBulkOrders = async (
    orders: SteadfastOrderPayload[],
): Promise<CourierResult<SteadfastBulkResultItem[]>> => {
    const result = await request<unknown>("/create_order/bulk-order", {
        method: "POST",
        body: { data: orders },
    });

    if (result.outcome !== "ok") return result;

    return parseBulkResponse(result.data);
};

export interface SteadfastStatusResponse {
    status: number;
    delivery_status: string;
}

const getStatusByConsignmentId = (consignmentId: string) =>
    request<SteadfastStatusResponse>(`/status_by_cid/${encodeURIComponent(consignmentId)}`);

/**
 * Status by the invoice we sent. This is the reconciliation path for a dispatch
 * whose outcome was never confirmed: we know exactly which invoices were in
 * flight, so each can be resolved without a manual portal check.
 */
const getStatusByInvoice = (invoice: string) =>
    request<SteadfastStatusResponse>(`/status_by_invoice/${encodeURIComponent(invoice)}`);

export interface SteadfastBalanceResponse {
    status: number;
    current_balance: number;
}

const getBalance = () => request<SteadfastBalanceResponse>("/get_balance");

export interface SteadfastReturnResponse {
    id: number;
    consignment_id: number;
    reason: string | null;
    status: string;
    [key: string]: unknown;
}

const createReturnRequest = (consignmentId: string, reason?: string) =>
    request<SteadfastReturnResponse>("/create_return_request", {
        method: "POST",
        body: {
            consignment_id: Number(consignmentId),
            ...(reason ? { reason } : {}),
        },
    });

export const SteadfastClient = {
    isCourierConfigured,
    createBulkOrders,
    getStatusByConsignmentId,
    getStatusByInvoice,
    getBalance,
    createReturnRequest,
};
