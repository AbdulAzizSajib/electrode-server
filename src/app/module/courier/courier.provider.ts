/**
 * The courier provider interface — what any courier integration must offer.
 *
 * EXTRACTED FROM A WORKING CLIENT, NOT DESIGNED AHEAD OF ONE. Every shape below
 * is `steadfast.client.ts`'s existing surface with the names generalised, which
 * is deliberate: deriving the interface from one real implementation risks it
 * being Steadfast-shaped, while designing it from two imagined couriers risks it
 * being shaped by neither. The first failure is visible and fixable when the
 * second adapter is written; the second is invisible until both are wrong.
 *
 * `add-steadfast-courier-integration` recorded a carrier abstraction as an
 * explicit Non-Goal — "a second courier is a second module and a decision made
 * then, not a set of interfaces guessed at now". This file is that decision,
 * made with a working integration to derive from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVIDERS TRANSLATE. THE SERVICE ORCHESTRATES.
 *
 * A provider decides what a courier is told and what its answer means: HTTP
 * shape, auth headers, field limits, phone format, address composition, its own
 * status vocabulary and how that maps onto `ShipmentStatus`.
 *
 * `courier.service.ts` decides what we DO about it, and none of that is
 * per-provider: deduplicating a selection before anything runs, eligibility
 * ordering, batching at 50 with results persisted BEFORE the next batch is sent,
 * matching results by invoice rather than array position, and the single
 * `applyCourierStatus` both status paths converge on.
 *
 * That split is not stylistic. Each of those service-side properties exists
 * because getting it wrong duplicates a consignment or corrupts a status — a
 * merchant paying for two pickups of one parcel, or a customer given another
 * order's tracking number. A provider free to override them would be free to
 * reintroduce them.
 *
 * See openspec/changes/add-courier-provider-selection, design.md Decisions 1
 * and 2.
 */
import { CourierProvider, ShipmentStatus } from "../../../generated/prisma/client";
import { CourierIneligibleReason, ICourierOrderForDispatch } from "./courier.interface";

/**
 * How a courier call ended.
 *
 * Three outcomes, not two, and collapsing them is how a merchant pays for two
 * pickups of one parcel:
 *
 *  - `ok`          — the courier answered and we understood it.
 *  - `failed`      — we reached the courier and it rejected us. Nothing was
 *                    created, so retrying is safe.
 *  - `unconfirmed` — the request timed out or the response was unreadable.
 *                    Aborting our fetch does NOT abort the courier's handler, so
 *                    what we asked for may well exist and we simply do not know.
 *                    Retrying is NOT safe.
 *
 * `unconfirmed` is not a Steadfast detail. It is what any HTTP call means when
 * it times out, which is why it belongs on the interface rather than inside one
 * adapter. The storefront draws the same distinction for the same reason — see
 * `nextjs/src/lib/api-proxy.ts`, which returns 504 for a checkout that may have
 * committed and 503 for one that certainly did not.
 */
export type CourierResult<T> =
    | { outcome: "ok"; data: T }
    | { outcome: "failed"; status: number; message: string }
    | { outcome: "unconfirmed"; message: string };

/**
 * What a provider can do.
 *
 * Declared rather than inferred, and enforced on BOTH sides: the admin hides an
 * undeclared action, and the service refuses it if called directly. Hiding alone
 * leaves an endpoint that fails confusingly; refusing alone leaves buttons that
 * exist only to fail.
 *
 * Couriers genuinely differ here — not every one exposes a balance endpoint or
 * accepts a return request over its API — and a panel showing a balance button
 * for a courier that has no balance endpoint teaches staff that the panel is
 * unreliable.
 *
 * See design.md Decision 7.
 */
export interface ICourierCapabilities {
    /** Can create consignments. False for MANUAL. */
    dispatch: boolean;
    /** Can be polled for a consignment's current status — what reconciliation needs. */
    status: boolean;
    /** Exposes an account balance. */
    balance: boolean;
    /** Accepts return requests over its API. */
    returns: boolean;
    /** Pushes status notifications to an endpoint we host. */
    webhook: boolean;
}

/** Every capability off — the base MANUAL declares and the shape a new adapter
 *  starts from, so adding a capability is an explicit act. */
export const NO_CAPABILITIES: ICourierCapabilities = {
    dispatch: false,
    status: false,
    balance: false,
    returns: false,
    webhook: false,
};

/**
 * One consignment as accepted by a provider's dispatch call.
 *
 * `invoice` is the only field the service reads, because it is the only one that
 * is provider-independent: it is `Order.orderNumber`, already unique, already
 * immutable, and already what the parcel's printed barcode encodes. Matching
 * results back to orders is done on it (never on array position), so it must
 * survive the round trip whatever else a provider needs.
 *
 * Everything else a courier requires is the adapter's business and travels in
 * `payload`, opaque to the service.
 */
export interface ICourierConsignmentRequest {
    invoice: string;
    payload: unknown;
}

/** One consignment's outcome, keyed by the invoice that produced it. */
export interface ICourierConsignmentResult {
    invoice: string;
    /** Present only when the courier accepted it. */
    consignmentId: string | null;
    trackingCode: string | null;
    /** Whether the courier accepted this specific consignment. A provider
     *  translates its own success flag into this; the service does not parse
     *  courier-specific status strings. */
    accepted: boolean;
    /** Why it was rejected, when the courier says. */
    message?: string;
}

/**
 * Why an order cannot be expressed as a consignment for THIS provider.
 *
 * Mapping never truncates and never guesses. A value that does not fit is a
 * refusal carrying a reason the operator can act on, because a truncated address
 * looks plausible, passes the courier's own validation, and delivers the parcel
 * nowhere — discovered a week later, which is the most expensive outcome
 * available.
 */
export type CourierMapResult =
    | { ok: true; request: ICourierConsignmentRequest }
    | { ok: false; reason: CourierIneligibleReason; detail: string };

/** What a status lookup tells us. The raw string is the provider's own
 *  vocabulary, kept verbatim; `shipmentStatus` is what we do about it. */
export interface ICourierStatusReading {
    /** The courier's own status string, normalised for comparison only. */
    rawStatus: string;
    shipmentStatus: ShipmentStatus;
    /** Whether this status means the ORDER is delivered. Deliberately narrower
     *  than `shipmentStatus === DELIVERED`: a partial delivery completes the
     *  parcel's journey without completing the order. */
    isFullyDelivered: boolean;
    /** Settled at the courier — nothing further will happen, so reconciliation
     *  stops polling it and a provider switch is no longer blocked by it. */
    isTerminal: boolean;
    /** A human has to look at this one. */
    needsAttention: boolean;
}

/** A return request, as much of it as is worth recording. */
export interface ICourierReturnResult {
    id: string | number;
    status: string;
    [key: string]: unknown;
}

/**
 * What every courier integration implements.
 *
 * Optional methods correspond exactly to optional capabilities: a provider
 * declaring `balance: true` MUST implement `getBalance`, and one declaring it
 * false must not be called for it. `verify-courier-provider.ts` asserts that
 * correspondence, because a declaration is a claim the code can contradict.
 */
export interface ICourierProvider {
    /** The enum member this adapter is registered under. */
    readonly id: CourierProvider;

    /** What staff see. Every courier action in the admin names this rather than
     *  a hardcoded courier, so an operator dispatching through one courier is
     *  never shown another's name. */
    readonly displayName: string;

    readonly capabilities: ICourierCapabilities;

    /** Whether this provider's credentials are present. Never discloses them —
     *  the admin is told only whether each is set. */
    isConfigured(): boolean;

    /** Whether the webhook token is set, for providers that push. */
    isWebhookConfigured(): boolean;

    /**
     * Turns one order into this provider's consignment request, or explains the
     * refusal in that provider's terms ("the courier allows 250 characters").
     *
     * Pure: no network, no database. The service calls it twice — once for the
     * preview, once at dispatch — because the two reads are separate queries and
     * an order can change between them.
     */
    mapOrder(order: ICourierOrderForDispatch): CourierMapResult;

    /**
     * Creates consignments. Required when `capabilities.dispatch`.
     *
     * The service batches; this receives one batch. Results are returned per
     * consignment and are matched back by `invoice` — an implementation must not
     * rely on the returned array being ordered like the request, and must not
     * assume every request appears in it. An invoice sent but absent from the
     * response is `unconfirmed`, not failed, and the service handles that.
     */
    createConsignments?(
        requests: ICourierConsignmentRequest[],
    ): Promise<CourierResult<ICourierConsignmentResult[]>>;

    /** Reads one consignment's current status. Required when `capabilities.status` —
     *  this is what reconciliation polls. */
    getStatus?(consignmentId: string): Promise<CourierResult<ICourierStatusReading>>;

    /**
     * Interprets one of this courier's status strings, with no network call.
     *
     * The webhook path needs this: a notification arrives carrying a status, and
     * what that string MEANS — is it terminal, is the order delivered, does a
     * human need to look — is the provider's to say, not the service's. Without
     * it the service would be parsing another company's vocabulary, which is
     * exactly the coupling this interface removes.
     *
     * Required alongside `capabilities.webhook`, and shared with `getStatus`, so
     * a status reported by push and the same status discovered by polling cannot
     * be interpreted differently.
     */
    readStatus?(rawStatus: string): ICourierStatusReading;

    /** Required when `capabilities.balance`. */
    getBalance?(): Promise<CourierResult<{ currentBalance: number }>>;

    /** Required when `capabilities.returns`. */
    createReturnRequest?(
        consignmentId: string,
        reason?: string,
    ): Promise<CourierResult<ICourierReturnResult>>;

    /**
     * Interprets one webhook body in this provider's own format. Required when
     * `capabilities.webhook`.
     *
     * Returns the consignment it concerns and what it reports. The service does
     * the matching, the deduplicating and the applying — a provider only says
     * what the payload means.
     */
    parseWebhook?(body: unknown): ICourierWebhookReading | null;

    /** This provider's expected webhook bearer token, or undefined when unset.
     *  Read through the provider so each one's token is looked up by provider
     *  rather than a single shared secret opening every endpoint. */
    webhookToken?(): string | undefined;
}

/** What one webhook notification says, in provider-independent terms. */
export interface ICourierWebhookReading {
    consignmentId: string;
    notificationType: string;
    /** Absent on a pure tracking message that reports no status change. */
    rawStatus?: string;
    trackingMessage?: string;
    codAmount?: number;
    deliveryCharge?: number;
    /** The courier's own timestamp — when the event happened, as distinct from
     *  when we heard about it. They diverge whenever a delivery is delayed or
     *  replayed. */
    courierUpdatedAt?: Date;
}
