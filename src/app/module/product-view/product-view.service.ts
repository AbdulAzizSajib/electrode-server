import { createHmac } from "crypto";
import { envVars } from "../../config/env";
import { prisma } from "../../lib/prisma";

/**
 * Recording product-page views.
 *
 * The counter this maintains (`Product.viewCount`) is a LIFETIME TOTAL. It says
 * nothing about the present moment, and nothing here computes a live figure.
 * See add-product-view-tracking design.md.
 */

/**
 * How long one viewer's view of one product is remembered for dedup purposes.
 *
 * A reload, a back-navigation, or a re-render inside this window is the same
 * visit and must not inflate the count. A return the next day is renewed
 * interest and counts again — which needs no expiry job, because the window
 * start is part of the unique key, so a later window is simply a new row.
 */
const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * User agents that are not a person considering a purchase.
 *
 * Matched case-insensitively as substrings. This will never be exhaustive —
 * it does not have to be. A crawler that slips through inflates a merchandising
 * signal slightly; the failure mode is a soft one, and over-blocking a real
 * shopper is the worse error.
 */
const BOT_PATTERNS = [
    "bot",
    "crawler",
    "spider",
    "slurp",
    "curl",
    "wget",
    "python-requests",
    "headlesschrome",
    "lighthouse",
    "pingdom",
    "uptimerobot",
    "facebookexternalhit",
    "preview",
];

export const isBotUserAgent = (userAgent: string | undefined): boolean => {
    if (!userAgent) return true; // No UA at all is not a browser.
    const ua = userAgent.toLowerCase();
    return BOT_PATTERNS.some((pattern) => ua.includes(pattern));
};

/**
 * The start of the dedup window a moment falls in, truncated to the window
 * size. Two views by the same viewer land on the same value — and therefore
 * collide on the unique constraint — exactly when they belong to the same
 * window.
 */
export const windowStartFor = (at: Date): Date =>
    new Date(Math.floor(at.getTime() / DEDUP_WINDOW_MS) * DEDUP_WINDOW_MS);

/**
 * An opaque, stable identity for the viewer.
 *
 * A signed-in shopper is their customer id, so the same person on two devices
 * is counted once. Everyone else is a keyed hash of IP + user-agent.
 *
 * The raw IP is NEVER stored: an address sitting beside a browsing history is
 * personal data. The hash is only ever compared, never reversed, and keying it
 * with a server-side secret means it cannot be recomputed from an address alone
 * by anyone who obtains the table.
 *
 * Including the user-agent separates most devices behind one shared address —
 * an office or carrier NAT still collapses some people together, which
 * under-counts. That is the right direction to err: under-reporting a real
 * signal beats inflating it.
 * See add-product-view-tracking design.md Risks.
 */
export const viewerKeyFor = (
    userId: string | undefined,
    // Express types this as possibly an array; normalised rather than narrowed
    // at the call site so every caller cannot forget to.
    ip: string | string[] | undefined,
    userAgent: string | undefined,
): string => {
    if (userId) return `u:${userId}`;

    const address = Array.isArray(ip) ? ip[0] : ip;

    return `a:${createHmac("sha256", envVars.BETTER_AUTH_SECRET)
        .update(`${address ?? "unknown"}|${userAgent ?? "unknown"}`)
        .digest("hex")}`;
};

/**
 * Records one view, deduplicated.
 *
 * Returns nothing about whether the view counted. That is deliberate: a caller
 * able to distinguish "counted" from "already seen" could probe whether a given
 * viewer key has visited a product, which is exactly the inference the hashing
 * above exists to prevent.
 *
 * The insert and the increment share a transaction, and the increment is atomic
 * (`{ increment: 1 }`) rather than a read-modify-write — under concurrency the
 * latter loses views precisely when a product is popular enough to be worth
 * counting.
 */
const recordView = async (
    productId: string,
    viewerKey: string,
    at: Date = new Date(),
): Promise<void> => {
    try {
        await prisma.$transaction(async (tx) => {
            await tx.productView.create({
                data: { productId, viewerKey, windowStart: windowStartFor(at) },
            });

            await tx.product.update({
                where: { id: productId },
                data: { viewCount: { increment: 1 } },
            });
        });
    } catch {
        /*
         * Swallowed on purpose, and this is the ordinary path rather than an
         * error case: a unique-constraint violation means this viewer has
         * already been counted for this product in this window, which is the
         * dedup working. A missing product (deleted between page load and this
         * call) lands here too. Neither is worth telling the caller about — the
         * response is identical either way.
         */
    }
};

export const ProductViewService = { recordView };
