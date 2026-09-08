import { timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { envVars } from "../../config/env";
import AppError from "../../errorHelpers/AppError";

/**
 * The two machine-to-machine guards on this module.
 *
 * Neither can use `checkAuth`: Vercel Cron and Steadfast have no session here.
 * A shared secret is therefore the entire boundary in both cases, which is why
 * both compare in constant time and both refuse outright when unconfigured —
 * accepting unauthenticated status updates is worse than accepting none.
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
 * Guards `POST /courier/webhook`, called by Steadfast.
 *
 * The token is one WE generate and paste into their portal's Webhook
 * Integration form; it is not issued by them. It is the whole authentication
 * boundary on a public endpoint, so an unset token refuses everything rather
 * than falling open.
 */
export const requireWebhookToken = (req: Request, _res: Response, next: NextFunction) => {
    const expected = envVars.STEADFAST_WEBHOOK_TOKEN;

    if (!expected) {
        warnOnce(
            "webhook",
            "[courier] STEADFAST_WEBHOOK_TOKEN is not set — the courier webhook will refuse every call and delivery statuses will only update on the reconciliation schedule.",
        );
        return next(
            new AppError(
                httpStatus.SERVICE_UNAVAILABLE,
                "Courier webhook is not configured (STEADFAST_WEBHOOK_TOKEN).",
            ),
        );
    }

    const header = req.header("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

    if (!provided || !secretMatches(provided, expected)) {
        return next(new AppError(httpStatus.UNAUTHORIZED, "Invalid webhook token."));
    }

    next();
};
