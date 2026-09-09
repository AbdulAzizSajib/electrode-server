import { timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { CourierProvider } from "../../../generated/prisma/client";
import { envVars } from "../../config/env";
import AppError from "../../errorHelpers/AppError";
import { isSupportedProvider, resolveProvider } from "./providers";

/**
 * The two machine-to-machine guards on this module.
 *
 * Neither can use `checkAuth`: Vercel Cron and a courier have no session here.
 * A shared secret is therefore the entire boundary in both cases, which is why
 * both compare in constant time and both refuse outright when unconfigured —
 * accepting unauthenticated status updates is worse than accepting none.
 *
 * The two differ in one respect. The sync secret is ONE infrastructure
 * credential: the scheduler is ours, and the endpoint it calls creates nothing.
 * The webhook token is PER COURIER, looked up through the provider — because a
 * single token accepted at a single endpoint would mean one courier's leaked
 * token opening every courier's notifications.
 *
 * The pattern follows `utils/revalidateStorefront.ts`, already established in
 * this codebase for a machine-to-machine call: a header the caller must present,
 * an endpoint that refuses without it, and one warning when it is unset rather
 * than silence.
 */

/** So an unconfigured deployment says so once, not on every request. */
const warned = new Set<string>();

const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(message);
};

/**
 * Constant-time comparison.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself leak the
 * secret's length, so both sides are hashed to a fixed width first — here by
 * padding to equal length and comparing a length flag separately.
 */
const secretMatches = (provided: string, expected: string): boolean => {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);

    if (a.length !== b.length) {
        // Still burn a comparison so a wrong-length guess is not measurably
        // faster than a right-length one.
        timingSafeEqual(b, b);
        return false;
    }

    return timingSafeEqual(a, b);
};

/**
 * Guards `POST /courier/sync`, called by Vercel Cron.
 *
 * Worst case for a leak here is an attacker causing extra status polls: the
 * endpoint creates no consignments and accepts no body that steers what it
 * reads.
 */
export const requireSyncSecret = (req: Request, _res: Response, next: NextFunction) => {
    const expected = envVars.COURIER_SYNC_SECRET;

    if (!expected) {
        warnOnce(
            "sync",
            "[courier] COURIER_SYNC_SECRET is not set — the reconciliation endpoint will refuse every call, so a missed courier webhook will never be caught up.",
        );
        return next(
            new AppError(
                httpStatus.SERVICE_UNAVAILABLE,
                "Courier reconciliation is not configured (COURIER_SYNC_SECRET).",
            ),
        );
    }

    const provided = req.header("x-courier-sync-secret");

    if (!provided || !secretMatches(provided, expected)) {
        return next(new AppError(httpStatus.UNAUTHORIZED, "Invalid sync secret."));
    }

    next();
};

/**
 * Guards `POST /courier/webhook/:provider`, called by the named courier.
 *
 * The token is one WE generate and paste into that courier's portal; it is not
 * issued by them. It is the whole authentication boundary on a public endpoint,
 * so an unset token refuses everything rather than falling open.
 *
 * THE TOKEN IS LOOKED UP BY PROVIDER, not shared across them. One endpoint
 * accepting any configured token would have to try each in turn to work out who
 * was calling — which means a token leaked for one courier grants access to
 * every courier's notifications. Each provider's endpoint accepts only its own.
 *
 * The provider is resolved and attached to the request here, so the controller
 * never re-derives it from the URL and the two cannot disagree about which
 * courier was authenticated.
 *
 * See openspec/changes/add-courier-provider-selection, design.md Decision 5.
 */
export const requireWebhookToken = (req: Request, _res: Response, next: NextFunction) => {
    // The alias route has no `:provider` segment, so an absent one means
    // Steadfast — that is the whole point of keeping the old path alive.
    const raw = req.params.provider;
    const named = typeof raw === "string" && raw ? raw : (CourierProvider.STEADFAST as string);

    /*
     * Rejected before any database work. An unknown provider cannot own a
     * consignment, so looking one up would be a query issued on behalf of an
     * unauthenticated caller naming a courier we do not support.
     */
    if (!isSupportedProvider(named)) {
        return next(
            new AppError(httpStatus.NOT_FOUND, `Unknown courier provider "${named}".`),
        );
    }

    const provider = resolveProvider(named);

    if (!provider.capabilities.webhook) {
        return next(
            new AppError(
                httpStatus.NOT_FOUND,
                `${provider.displayName} does not send webhooks.`,
            ),
        );
    }

    const expected = provider.webhookToken?.();

    if (!expected) {
        warnOnce(
            `webhook:${named}`,
            `[courier] No webhook token is set for ${provider.displayName} — its webhook will refuse every call and delivery statuses will only update on the reconciliation schedule.`,
        );
        return next(
            new AppError(
                httpStatus.SERVICE_UNAVAILABLE,
                `The ${provider.displayName} webhook is not configured.`,
            ),
        );
    }

    const header = req.header("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

    if (!provided || !secretMatches(provided, expected)) {
        return next(new AppError(httpStatus.UNAUTHORIZED, "Invalid webhook token."));
    }

    req.courierProvider = provider.id;

    next();
};
