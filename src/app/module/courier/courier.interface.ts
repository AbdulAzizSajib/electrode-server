import { RoleName } from "../../constants/role.constant";

/**
 * Why an order cannot be dispatched.
 *
 * A closed set rather than free text, so the admin panel can group and count
 * refusals ("6 orders have no usable phone") instead of rendering twenty
 * variations of the same sentence. The human-readable `detail` travels beside
 * it and carries the specifics.
 */
export type CourierIneligibleReason =
    | "NOT_PACKED"
    | "ALREADY_DISPATCHED"
    | "NO_SHIPPING_ADDRESS"
    | "NO_RECIPIENT_NAME"
    | "NAME_TOO_LONG"
    | "INVALID_PHONE"
    | "ADDRESS_TOO_LONG";

/** The order shape the mapper and pre-flight need. Deliberately narrow: it is a
 *  contract with the query in `courier.service.ts`, not a mirror of the model. */
export interface ICourierOrderForDispatch {
    id: string;
    orderNumber: string;
    status: string;
    notes: string | null;
    totalAmount: unknown;
    customer: {
        firstName: string;
        lastName: string | null;
        phone: string | null;
    };
    shippingAddress: {
        fullName: string;
        phone: string;
        addressLine1: string;
        addressLine2: string | null;
        city: string;
        state: string | null;
        postalCode: string | null;
    } | null;
    payments: { amount: unknown; status: string }[];
    shipments: {
        id: string;
        consignmentId: string | null;
    }[];
}

/** One order's verdict before anything is sent. */
export interface ICourierEligibility {
    orderId: string;
    orderNumber: string;
    eligible: boolean;
    reason?: CourierIneligibleReason;
    detail?: string;
    /** Present on an already-dispatched order, so the panel can show what exists
     *  rather than only refusing. */
    consignmentId?: string | null;
    trackingCode?: string | null;
}

/**
 * What happened to one order in a dispatch.
 *
 * `failed` and `unconfirmed` are separate on purpose and must stay that way.
 * A failed order definitely has no consignment and is safe to send again; an
 * unconfirmed one may already have one nobody has seen, and retrying it is how
 * a merchant pays for two pickups of one parcel.
 */
export type CourierDispatchOutcome =
    | "dispatched"
    | "ineligible"
    | "failed"
    | "unconfirmed";

export interface ICourierDispatchResult {
    orderId: string;
    orderNumber: string;
    outcome: CourierDispatchOutcome;
    reason?: CourierIneligibleReason;
    detail?: string;
    consignmentId?: string | null;
    trackingCode?: string | null;
}

export interface ICourierDispatchSummary {
    dispatched: number;
    ineligible: number;
    failed: number;
    unconfirmed: number;
    results: ICourierDispatchResult[];
}

/** Who performed a dispatch, for the audit record. */
export interface ICourierActor {
    userId: string;
    role: RoleName;
    email: string;
}

/** The two notification types Steadfast's webhook sends. */
export type CourierNotificationType = "delivery_status" | "tracking_update";

export interface ICourierWebhookPayload {
    notification_type: CourierNotificationType | string;
    consignment_id: number | string;
    invoice?: string;
    status?: string;
    cod_amount?: number | string;
    delivery_charge?: number | string;
    tracking_message?: string;
    updated_at?: string;
}
