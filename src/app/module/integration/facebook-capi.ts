/**
 * Reports a completed order to Meta's Conversions API, from the server.
 *
 * WHY A SERVER-SIDE COPY OF AN EVENT THE BROWSER ALREADY SENDS. The browser
 * pixel loses roughly a third to a half of its events to ad blockers, iOS
 * tracking prevention, and shoppers who close the tab before the script runs.
 * Meta reads that as campaigns performing worse than they do, and narrows
 * delivery accordingly — so the merchant pays for the measurement gap twice.
 * This path is not blockable: it is our server talking to Meta's, with no
 * browser in between.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH PATHS SEND THE SAME `event_id`, WHICH IS THE ORDER'S ID.
 *
 * Meta collapses two events sharing an `event_id` and `event_name` into one
 * conversion. Without that, the two paths are ADDITIVE: every sale is counted
 * roughly twice, the merchant reads doubled conversions, and raises ad spend
 * against revenue that does not exist. That failure is worse than not shipping
 * this at all, which is why the id is not optional and not generated here — it
 * is the order id, which the confirmation page already has, so the browser and
 * the server cannot disagree about it. See design.md Decision 10.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE PROPERTIES, MODELLED ON `utils/revalidateStorefront.ts`:
 *
 *  1. **It never fails an order.** The order has already committed by the time
 *     this runs. A Meta outage, a revoked token, a network blip — none of them
 *     may turn a completed purchase into an error on the confirmation the
 *     shopper is reading. Every failure is logged and swallowed.
 *  2. **It is not awaited.** Order creation fires and forgets, so a shopper
 *     never waits on a measurement call.
 *  3. **It is a no-op when unconfigured or disabled.** No token means nothing to
 *     authenticate with, so it returns quietly rather than sending a request
 *     that could only 401.
 *
 * The accepted cost of (2) is that a serverless function may be frozen before
 * the request completes, losing a small fraction of events. That is acceptable
 * for measurement and would not be for the order itself — which is precisely why
 * the order is written and committed independently of this.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PII IS HASHED, ALWAYS. Meta requires SHA-256 of normalised values, and sending
 * a raw email or phone would hand a third party customer identities the shopper
 * never agreed to share. Normalisation must happen BEFORE hashing or the hash
 * matches nothing and the data is sent for no benefit at all.
 *
 * See openspec/changes/rename-courier-setting-to-integrations, design.md
 * Decisions 9 and 10.
 */
import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { CredentialKind, IntegrationId } from "./integration.constant";
import { IntegrationService } from "./integration.service";

/** Short: this is a background report, not something worth holding a socket for. */
const TIMEOUT_MS = 3000;

/** Pinned rather than floating. A version bump can change required fields, and
 *  discovering that through silently rejected events is the worst way to learn. */
const GRAPH_VERSION = "v21.0";

/** So an unconfigured deployment says so once, not on every order. */
let warnedUnconfigured = false;

/** What the settings column carries for this integration. */
interface IFacebookCapiConfig {
    enabled: boolean;
    testMode: boolean;
    testEventCode: string;
}

/** One order, as much of it as Meta is told about. */
export interface ICapiPurchase {
    /** The order id. Also the `event_id` both paths deduplicate on. */
    orderId: string;
    value: number;
    currency: string;
    email?: string | null;
    phone?: string | null;
    /** When the order was placed, not when this ran — they diverge on a retry. */
    createdAt?: Date;
}

/**
 * SHA-256 of a normalised value, or undefined when there is nothing to hash.
 *
 * Normalisation is Meta's, not ours: lowercase and trim. A value hashed without
 * it produces a digest that matches no user profile, so the PII is transmitted
 * and buys nothing — the worst of both outcomes.
 */
const hash = (value: string | null | undefined): string | undefined => {
    if (!value) return undefined;

    const normalised = value.trim().toLowerCase();
    if (!normalised) return undefined;

    return createHash("sha256").update(normalised).digest("hex");
};

/**
 * A phone number reduced to digits, then hashed.
 *
 * Meta matches on digits only — a stored `+8801712345678` and a shopper's
 * `01712345678` are the same person and must produce the same digest, which
 * they only do once the punctuation and country prefix handling are consistent.
 */
const hashPhone = (value: string | null | undefined): string | undefined => {
    if (!value) return undefined;

    const digits = value.replace(/\D/g, "");
    if (!digits) return undefined;

    return createHash("sha256").update(digits).digest("hex");
};

/**
 * Both halves of the public config, in one read.
 *
 * The pixel id and the CAPI settings live on the same column, so they are read
 * together — an event needs to know which pixel it belongs to, and splitting
 * this into two queries would double the cost for no benefit.
 */
const readConfig = async (): Promise<{
    capi: IFacebookCapiConfig | null;
    pixelId: string | null;
}> => {
    const row = await prisma.storeSetting.findUnique({
        where: { id: "singleton" },
        select: { integrationConfig: true },
    });

    const config = row?.integrationConfig as {
        facebookCapi?: IFacebookCapiConfig;
        facebookPixel?: { pixelId?: string };
    } | null;

    return {
        capi: config?.facebookCapi ?? null,
        pixelId: config?.facebookPixel?.pixelId || null,
    };
};

/**
 * Sends one Purchase event. Never throws, never awaited by a request.
 *
 * Exported as a plain `void` function rather than a promise-returning one so a
 * caller cannot accidentally `await` it and reintroduce the latency this is
 * shaped to avoid.
 */
export const reportPurchaseToCapi = (purchase: ICapiPurchase): void => {
    void (async () => {
        try {
            const { capi: config, pixelId } = await readConfig();

            // Two switches, both of which must be on: the config flag the
            // merchant sets on this card, and the integration's own enabled
            // state, which is what "disabled" means everywhere else in the
            // panel. Either one off means send nothing.
            if (!config?.enabled) return;
            if (!(await IntegrationService.isEnabled(IntegrationId.FACEBOOK_CAPI))) return;

            /*
             * The pixel id comes from the PUBLIC half of the config and the
             * access token from the encrypted half. Both are required: an event
             * needs to know which pixel it belongs to, and Meta needs to know we
             * are allowed to write to it.
             */
            const credentials = await IntegrationService.resolveCredentials(
                IntegrationId.FACEBOOK_CAPI,
            );
            const accessToken = credentials[CredentialKind.ACCESS_TOKEN];

            if (!pixelId || !accessToken) {
                if (!warnedUnconfigured) {
                    warnedUnconfigured = true;
                    console.warn(
                        "[capi] The Conversions API is enabled but not fully configured (needs a Pixel ID and an access token), so no server-side events are being sent. Configure it at admin UI → Integrations.",
                    );
                }
                return;
            }

            const body = {
                data: [
                    {
                        event_name: "Purchase",
                        event_time: Math.floor(
                            (purchase.createdAt?.getTime() ?? Date.now()) / 1000,
                        ),
                        /*
                         * The deduplication key. Identical to what the browser
                         * pixel sends for this order — see the header comment.
                         */
                        event_id: purchase.orderId,
                        action_source: "website",
                        user_data: {
                            em: hash(purchase.email),
                            ph: hashPhone(purchase.phone),
                        },
                        custom_data: {
                            value: purchase.value,
                            currency: purchase.currency,
                        },
                    },
                ],
                /*
                 * Attached only while test mode is on. Sending it otherwise
                 * would route real conversions into Meta's test stream, where
                 * they are visible in the debug panel and counted nowhere.
                 */
                ...(config.testMode && config.testEventCode
                    ? { test_event_code: config.testEventCode }
                    : {}),
            };

            const response = await fetch(
                `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                },
            );

            if (!response.ok) {
                /*
                 * Logged with Meta's own words, which name the cause — an
                 * expired token and a malformed payload are different problems
                 * and the status alone cannot tell them apart. The URL is NOT
                 * logged: it carries the access token in its query string.
                 */
                const detail = await response.text().catch(() => "");
                console.error(
                    `[capi] Meta rejected the Purchase event for order ${purchase.orderId} (${response.status}): ${detail.slice(0, 300)}`,
                );
            }
        } catch (error) {
            // Measurement is never worth failing an order over, and the order
            // has already committed by the time this runs.
            console.error(
                `[capi] Could not report the Purchase event for order ${purchase.orderId}:`,
                error,
            );
        }
    })();
};
