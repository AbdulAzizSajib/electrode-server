/**
 * The provider registry — the one place an enum value becomes an implementation.
 *
 * ADDING A COURIER IS THIS FILE PLUS ONE ADAPTER. Nothing in
 * `courier.service.ts` changes, because the service orchestrates and the
 * adapter translates (see `courier.provider.ts`).
 *
 * The registry is keyed by the `CourierProvider` enum, so TypeScript's
 * exhaustiveness check catches a member added to the schema without an adapter
 * at compile time rather than at dispatch time. `resolveProvider` throws for an
 * unregistered value rather than returning undefined: a courier module that
 * silently produced `undefined` would fail somewhere further along, with a stack
 * trace pointing at the symptom instead of the cause.
 *
 * See openspec/changes/add-courier-provider-selection, design.md Decision 1.
 */
import status from "http-status";
import { CourierProvider } from "../../../../generated/prisma/client";
import AppError from "../../../errorHelpers/AppError";
import { ICourierProvider } from "../courier.provider";
import { ManualProvider } from "./manual.provider";
import { SteadfastProvider } from "./steadfast.provider";

/**
 * Every provider this system can dispatch through.
 *
 * `Record<CourierProvider, ...>` rather than a partial map: a new enum member
 * without an entry here is a build error, which is the only moment the omission
 * is cheap to notice.
 */
const REGISTRY: Record<CourierProvider, ICourierProvider> = {
    [CourierProvider.STEADFAST]: SteadfastProvider,
    [CourierProvider.MANUAL]: ManualProvider,
};

/** Every registered provider, for the admin's provider picker. */
export const listProviders = (): ICourierProvider[] => Object.values(REGISTRY);

/** Whether a string names a provider this system supports. Used by the webhook
 *  route, which takes the provider from the URL and must reject an unknown one
 *  before touching the database. */
export const isSupportedProvider = (value: string): value is CourierProvider =>
    Object.prototype.hasOwnProperty.call(REGISTRY, value);

/**
 * The adapter for one provider.
 *
 * Throws rather than returning undefined. The only way to reach the error is a
 * database row holding an enum value with no adapter — a deployment that shipped
 * a schema change without its code — and that deserves a message naming the
 * cause, not a downstream `cannot read property of undefined`.
 */
export const resolveProvider = (provider: CourierProvider): ICourierProvider => {
    const resolved = REGISTRY[provider];

    if (!resolved) {
        throw new AppError(
            status.INTERNAL_SERVER_ERROR,
            `No courier adapter is registered for "${provider}". A CourierProvider enum member was added without its adapter.`,
        );
    }

    return resolved;
};
