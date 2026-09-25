/**
 * Sends staff-facing operational alerts to the merchant's own Telegram chat.
 *
 * WHY THIS EXISTS. The in-app `Notification` rows written on checkout are
 * visible exactly where the merchant already is — at the desk, with the panel
 * open. For a cash-on-delivery shop the first action on a new order is a
 * confirmation call, and every hour between "order placed" and "someone called"
 * is a parcel more likely to be refused at the door. Telegram closes that gap
 * for nothing: a push notification that arrives whether or not anyone is at a
 * computer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE PROPERTIES, THE SAME ONES `facebook-capi.ts` HOLDS:
 *
 *  1. **It never fails the thing it announces.** The order, the stock write and
 *     the ticket have all committed by the time this runs. Every failure is
 *     logged and swallowed.
 *  2. **It is not awaited.** Nobody waits on Telegram to see a confirmation.
 *  3. **It is silent when unconfigured or switched off.** Not merely harmless —
 *     SILENT. A shop that has never connected Telegram must produce no error
 *     output from any of the four events, because an integration nobody
 *     configured is not a fault, and logging it as one trains operators to
 *     ignore the log. This is the one place this module deliberately differs
 *     from `facebook-capi.ts`, which warns once when it is enabled but missing
 *     its token.
 *
 * THERE IS NO RETRY AND NO QUEUE. A message that fails to send is lost. That is
 * affordable only because the in-app notification is still written and the panel
 * remains the source of truth — Telegram is the alert on top of the record, never
 * the record. If retry is ever wanted, the shape is an outbox table plus a
 * worker, and the call sites would write a row instead of calling this.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CREDENTIALS ARE RESOLVED BEFORE `isEnabled` IS CONSULTED, AND THE ORDER IS
 * LOAD-BEARING. `IntegrationService.isEnabled` returns `row?.enabled ?? true` —
 * it answers TRUE for an integration that has no row at all. That default is
 * correct where it came from (the courier migration must not stop dispatching
 * because nothing flipped a flag) and it means every shop that has never heard
 * of Telegram reports this integration as enabled. Gating on it first would put
 * the unconfigured path on the far side of a database read and, worse, invite a
 * "why is it enabled but doing nothing" log line on every order of every shop
 * that never wanted the feature.
 *
 * `resolveCredentials` already omits any kind that fails to decrypt, so an
 * unreadable token is indistinguishable from an absent one here — which is
 * exactly the behaviour required: both mean "cannot send".
 *
 * See openspec/changes/add-telegram-notifications, design.md Decisions 6 and 8.
 */
import { CredentialKind, IntegrationId } from "./integration.constant";
import { IntegrationService } from "./integration.service";

/** Short: this is a background alert, not something worth holding a socket for.
 *  Matched to `facebook-capi.ts` on purpose, so there is one answer in this
 *  module to "how long may an outbound integration call block". */
const TIMEOUT_MS = 3000;

/** `sendMessage` accepts 1–4096 characters of text after entity parsing. */
const MAX_MESSAGE_LENGTH = 4096;

/** Appended to a message that had to be cut, so a short message is never
 *  mistaken for the whole story. */
const TRUNCATION_MARKER = "\n…";

/**
 * What happened to one message.
 *
 * `skipped` and `failed` are kept apart because they need opposite treatment:
 * a skip is the normal state of an unconfigured shop and must stay silent,
 * while a failure is a real problem worth a log line — and, in the test-send
 * endpoint, worth showing the merchant.
 */
export type TelegramSendOutcome =
    | { status: "sent" }
    | { status: "skipped"; reason: string }
    | { status: "failed"; reason: string };

/**
 * Escapes the three characters that are significant to Telegram's HTML parse
 * mode. Every value taken from the database goes through this.
 *
 * WHY HTML AND NOT MarkdownV2. MarkdownV2 requires escaping eighteen
 * characters — `_ * [ ] ( ) ~ \` > # + - = | { } . !` — including `.` and `-`.
 * A Bangladeshi phone number and a hyphenated address both contain them, and one
 * unescaped character produces a 400 that, in a fire-and-forget path, means the
 * message silently never arrives. It would fail precisely for the orders whose
 * data is unusual, which is the worst possible distribution of a bug. Three
 * characters can be escaped correctly in a function that is hard to get wrong.
 *
 * `&` must be replaced FIRST or it would re-escape the ampersands introduced by
 * the other two replacements.
 */
export const escapeHtml = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return "";

    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

/**
 * Cuts a message down to what the API accepts, at a LINE boundary.
 *
 * Slicing mid-string would be the obvious implementation and would be wrong: it
 * can cut inside a `<b>` and hand Telegram unparseable markup, turning "this
 * order had many items" into "this order sent no message at all". Dropping whole
 * lines cannot, PROVIDED no tag opened on one line is closed on another — which
 * is a contract the message builders in this module keep.
 *
 * The single-line fallback exists for completeness rather than for any message
 * this module composes today.
 */
const truncate = (text: string): string => {
    if (text.length <= MAX_MESSAGE_LENGTH) return text;

    const budget = MAX_MESSAGE_LENGTH - TRUNCATION_MARKER.length;
    const kept: string[] = [];
    let used = 0;

    for (const line of text.split("\n")) {
        const cost = kept.length === 0 ? line.length : line.length + 1;
        if (used + cost > budget) break;
        kept.push(line);
        used += cost;
    }

    if (kept.length > 0) return kept.join("\n") + TRUNCATION_MARKER;

    // One line longer than the whole budget. Cut it, then walk back off a
    // dangling "<" so the slice cannot end inside a tag.
    const head = text.slice(0, budget);
    const lastOpen = head.lastIndexOf("<");
    const lastClose = head.lastIndexOf(">");

    return (lastOpen > lastClose ? head.slice(0, lastOpen) : head) + TRUNCATION_MARKER;
};

/**
 * Sends one message and reports what happened. AWAITED.
 *
 * Callers announcing an event must use `dispatchTelegramMessage` instead — this
 * one exists for the test-send endpoint, which is the single place in this
 * feature where a delivery failure is allowed to reach a caller.
 */
export const sendTelegramMessage = async (text: string): Promise<TelegramSendOutcome> => {
    // Credentials first. See the header comment — `isEnabled` cannot be the
    // first gate because it reports an integration with no row as enabled.
    const credentials = await IntegrationService.resolveCredentials(IntegrationId.TELEGRAM);
    const botToken = credentials[CredentialKind.BOT_TOKEN];
    const chatId = credentials[CredentialKind.CHAT_ID];

    if (!botToken && !chatId) {
        return { status: "skipped", reason: "Telegram is not configured." };
    }

    if (!botToken) {
        return { status: "skipped", reason: "The Telegram bot token is missing or unreadable." };
    }

    if (!chatId) {
        return { status: "skipped", reason: "The Telegram chat ID is missing." };
    }

    if (!(await IntegrationService.isEnabled(IntegrationId.TELEGRAM))) {
        return { status: "skipped", reason: "The Telegram integration is switched off." };
    }

    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: truncate(text),
                parse_mode: "HTML",
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        /*
         * Telegram answers a rejection with a non-2xx AND an `ok: false` body
         * carrying a `description` that names the cause — "chat not found",
         * "bot was blocked by the user", "Unauthorized". Both are checked
         * because the description is the only thing that distinguishes a wrong
         * chat id from a revoked token, and the merchant needs that distinction
         * to fix their own setup.
         */
        const payload = (await response.json().catch(() => null)) as {
            ok?: boolean;
            description?: string;
        } | null;

        if (!response.ok || payload?.ok !== true) {
            return {
                status: "failed",
                reason:
                    payload?.description ??
                    `Telegram rejected the message (HTTP ${response.status}).`,
            };
        }

        return { status: "sent" };
    } catch (error) {
        /*
         * A timeout arrives here as an AbortError. The URL is deliberately NOT
         * included in the reason: it carries the bot token in its path, and a
         * reason string reaches both the log and, from the test endpoint, the
         * admin panel.
         */
        return {
            status: "failed",
            reason: error instanceof Error ? error.message : "Could not reach Telegram.",
        };
    }
};

/**
 * Announces an event. Fire-and-forget: returns immediately, never rejects, and
 * cannot fail its caller.
 *
 * `label` names the event in the log line, so a failure says which alert was
 * lost rather than only that one was.
 */
export const dispatchTelegramMessage = (text: string, label: string): void => {
    void (async () => {
        try {
            const outcome = await sendTelegramMessage(text);

            // A skip is the normal state of a shop that never connected
            // Telegram. Logging it would be noise on every order, forever.
            if (outcome.status === "failed") {
                console.error(`[telegram] Could not send the ${label} alert: ${outcome.reason}`);
            }
        } catch (error) {
            // Unreachable by construction — `sendTelegramMessage` catches its
            // own failures. Kept so that a future edit which breaks that
            // property cannot take the process down with an unhandled rejection.
            console.error(`[telegram] Unexpected failure sending the ${label} alert:`, error);
        }
    })();
};
