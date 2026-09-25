/**
 * "Does this actually work?" — the one place in this module where a delivery
 * failure is allowed to reach a caller.
 *
 * WHY IT EXISTS. The Telegram chat id is typed by hand rather than detected
 * (see design.md Decision 4 for why auto-detection was rejected), and manual
 * entry has exactly one weakness: a typo produces silence. Without an explicit
 * verification step, the first evidence of a mistyped id is a missed order at
 * an unknown later date — the alert never arrives, and nothing anywhere says so,
 * because every other path in this feature swallows its failures by design.
 *
 * This endpoint inverts that posture deliberately: it AWAITS the send and
 * reports the reason, so the three setup mistakes that look identical from the
 * outside — a wrong chat id, a revoked token, and a bot that was never added to
 * the group — are told apart while the merchant is still on the page that
 * caused them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ITS OWN FILE. `telegram.ts` imports `IntegrationService` to resolve
 * credentials. Putting this map in `integration.service.ts` would make those two
 * modules import each other — survivable under ESM, since every use is inside a
 * function, but a cycle that a later edit could turn into a module-init crash
 * for no benefit. The controller imports this directly instead.
 *
 * See openspec/changes/add-telegram-notifications, design.md Decision 9.
 */
import status from "http-status";
import AppError from "../../errorHelpers/AppError";
import { IntegrationId } from "./integration.constant";
import { sendTelegramMessage, TelegramSendOutcome } from "./telegram";

/**
 * Providers that can prove themselves, by id.
 *
 * A map rather than a `testable` flag on the descriptor: the flag would exist to
 * describe one integration. When a second testable one appears this is one more
 * entry, and promoting it into the descriptor at that point is mechanical.
 */
const TEST_HANDLERS: Record<string, () => Promise<TelegramSendOutcome>> = {
    [IntegrationId.TELEGRAM]: () =>
        sendTelegramMessage(
            [
                "✅ <b>Test message</b>",
                "Your shop is connected. Order alerts will arrive here.",
            ].join("\n"),
        ),
};

/**
 * Sends a provider's test message and reports the outcome.
 *
 * Throws rather than returning a failure shape, because every caller of this is
 * an HTTP request and `globalErrorHandler` already renders an `AppError` into
 * the envelope both clients read.
 */
export const testIntegration = async (provider: string): Promise<{ message: string }> => {
    const handler = TEST_HANDLERS[provider];

    if (!handler) {
        throw new AppError(
            status.BAD_REQUEST,
            `${provider} does not support a test message.`,
        );
    }

    const outcome = await handler();

    /*
     * `skipped` means the integration is not in a state to send at all — no
     * credentials, or switched off. The reason names which, so the merchant is
     * not left guessing which field they missed. No outbound call was made.
     */
    if (outcome.status === "skipped") {
        throw new AppError(status.BAD_REQUEST, outcome.reason);
    }

    /*
     * `failed` means the request went out and did not work. BAD_GATEWAY rather
     * than BAD_REQUEST: the panel's request was well-formed, and it is the other
     * side that refused. The reason is Telegram's own `description` wherever it
     * gave one — "chat not found" tells a merchant what to fix in a way that
     * "the test failed" never will.
     */
    if (outcome.status === "failed") {
        throw new AppError(status.BAD_GATEWAY, outcome.reason);
    }

    return { message: "Test message sent." };
};
