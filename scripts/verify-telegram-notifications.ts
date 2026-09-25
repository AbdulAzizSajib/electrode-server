/**
 * Verification for Telegram alert dispatch.
 *
 * Every property here fails SILENTLY when it regresses, which is the whole
 * reason this file exists — a broken alert looks exactly like a quiet shop:
 *
 *  - An unconfigured shop makes no outbound call. If this regressed, every
 *    order on every deployment that never connected Telegram would fire a
 *    request that could only fail, and log about it.
 *  - A credential that will not decrypt behaves exactly like an absent one.
 *    Both mean "cannot send", and a caller distinguishing them would be a
 *    caller that can throw on the order path.
 *  - The disabled toggle actually stops sends. An off switch that does not
 *    switch anything off is worse than no switch, because the merchant stops
 *    looking for the cause.
 *  - Customer data containing `&`, `<` or `>` is escaped. Unescaped, Telegram
 *    answers 400 and — in a fire-and-forget path — the message silently never
 *    arrives, for exactly the orders whose data is unusual.
 *  - An over-long message is truncated, not dropped. `sendMessage` accepts at
 *    most 4096 characters; a large order must degrade to a shorter alert rather
 *    than to no alert.
 *
 * `fetch` is stubbed throughout, so this never contacts Telegram and needs no
 * bot token. Runs against the real database using the TELEGRAM integration's own
 * rows, whose prior state is captured and restored in a `finally`. Run with:
 *   npx tsx scripts/verify-telegram-notifications.ts
 */
import { prisma } from "../src/app/lib/prisma";
import { encryptSecret } from "../src/app/lib/crypto";
import { escapeHtml, sendTelegramMessage } from "../src/app/module/integration/telegram";
import { buildNewOrderMessage } from "../src/app/module/integration/telegram-messages";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const PROVIDER = "TELEGRAM";

/** Long enough to be unmistakable, short enough to read in a failure message. */
const TOKEN = "__verify_bot_token_123456789";
const CHAT_ID = "-1009999999999";

/** Every call `sendTelegramMessage` makes while a test is running. */
let calls: { url: string; body: Record<string, unknown> }[] = [];

const realFetch = globalThis.fetch;

/** Answers exactly as Telegram does on success, so the caller's success path is
 *  the one under test rather than an error path that happens to make no call. */
const stubFetch = (ok = true) => {
    calls = [];
    globalThis.fetch = (async (url: unknown, init: unknown) => {
        const request = init as { body?: string };
        calls.push({
            url: String(url),
            body: JSON.parse(request?.body ?? "{}") as Record<string, unknown>,
        });

        return {
            ok,
            status: ok ? 200 : 400,
            json: async () => (ok ? { ok: true, result: {} } : { ok: false, description: "chat not found" }),
        };
    }) as typeof globalThis.fetch;
};

const setCredentials = async (values: { kind: string; value: string }[]) => {
    await prisma.integrationCredential.deleteMany({ where: { provider: PROVIDER } });
    await prisma.integration.upsert({
        where: { provider: PROVIDER },
        create: { provider: PROVIDER, enabled: true },
        update: { enabled: true },
    });

    for (const { kind, value } of values) {
        await prisma.integrationCredential.create({
            data: { provider: PROVIDER, kind, value },
        });
    }
};

const priorCredentials = await prisma.integrationCredential.findMany({
    where: { provider: PROVIDER },
});
const priorRow = await prisma.integration.findUnique({ where: { provider: PROVIDER } });

try {
    // ── No credentials at all ────────────────────────────────────────────────
    await prisma.integrationCredential.deleteMany({ where: { provider: PROVIDER } });
    await prisma.integration.deleteMany({ where: { provider: PROVIDER } });

    stubFetch();
    const unconfigured = await sendTelegramMessage("should not be sent");

    check(
        "unconfigured shop is silent",
        unconfigured.status === "skipped" && calls.length === 0,
        `status=${unconfigured.status}, outbound calls=${calls.length}`,
    );

    check(
        "unconfigured shop reports no row as skipped, not enabled",
        unconfigured.status === "skipped",
        "isEnabled answers true for a missing row, so credentials must be the first gate",
    );

    // ── A credential that will not decrypt ───────────────────────────────────
    // Written as raw plaintext, which `crypto.ts` refuses on read rather than
    // honouring — deliberately, so a hand-written shortcut fails loudly.
    await setCredentials([
        { kind: "botToken", value: "plaintext-never-encrypted" },
        { kind: "chatId", value: encryptSecret(CHAT_ID) },
    ]);

    stubFetch();
    const unreadable = await sendTelegramMessage("should not be sent");

    check(
        "undecryptable token behaves like an absent one",
        unreadable.status === "skipped" && calls.length === 0,
        `status=${unreadable.status}, outbound calls=${calls.length}`,
    );

    // ── Configured and enabled ───────────────────────────────────────────────
    await setCredentials([
        { kind: "botToken", value: encryptSecret(TOKEN) },
        { kind: "chatId", value: encryptSecret(CHAT_ID) },
    ]);

    stubFetch();
    const sent = await sendTelegramMessage("hello");

    check(
        "configured and enabled sends",
        sent.status === "sent" && calls.length === 1,
        `status=${sent.status}, outbound calls=${calls.length}`,
    );

    check(
        "sends HTML parse mode to the configured chat",
        calls[0]?.body.parse_mode === "HTML" && calls[0]?.body.chat_id === CHAT_ID,
        `parse_mode=${String(calls[0]?.body.parse_mode)}, chat_id=${String(calls[0]?.body.chat_id)}`,
    );

    // ── Disabled while fully configured ──────────────────────────────────────
    await prisma.integration.update({
        where: { provider: PROVIDER },
        data: { enabled: false },
    });

    stubFetch();
    const disabled = await sendTelegramMessage("should not be sent");

    check(
        "the off switch stops sends",
        disabled.status === "skipped" && calls.length === 0,
        `status=${disabled.status}, outbound calls=${calls.length}`,
    );

    await prisma.integration.update({
        where: { provider: PROVIDER },
        data: { enabled: true },
    });

    // ── Escaping ─────────────────────────────────────────────────────────────
    check(
        "escapeHtml covers the three significant characters",
        escapeHtml("Ma & Co <b>x</b>") === "Ma &amp; Co &lt;b&gt;x&lt;/b&gt;",
        escapeHtml("Ma & Co <b>x</b>"),
    );

    const hostile = buildNewOrderMessage({
        id: "ord-1",
        orderNumber: "ORD-<1>",
        totalAmount: "1250.00",
        items: [{ productName: "Cable & Plug <2m>", quantity: 1, totalPrice: "1250.00" }],
        shippingAddress: {
            fullName: "A & B",
            phone: "01712-345678",
            addressLine1: "Road <7>",
            city: "Dhaka",
        },
    });

    check(
        "builder escapes customer data",
        !/<(?!\/?(b|a)\b)/.test(hostile) && hostile.includes("&amp;") && hostile.includes("&lt;"),
        "no raw angle bracket survives outside the tags the builder itself emits",
    );

    check(
        "a hyphenated phone number survives intact",
        hostile.includes("01712-345678"),
        "HTML mode needs no escaping for '-' or '.', which is why it is used over MarkdownV2",
    );

    stubFetch();
    await sendTelegramMessage(hostile);

    check(
        "an escaped message is still delivered",
        calls.length === 1,
        `outbound calls=${calls.length}`,
    );

    // ── Truncation ───────────────────────────────────────────────────────────
    const oversized = Array.from({ length: 400 }, (_, i) => `line ${i} of a very large order`).join(
        "\n",
    );

    stubFetch();
    const truncated = await sendTelegramMessage(oversized);
    const deliveredText = String(calls[0]?.body.text ?? "");

    check(
        "an over-long message is truncated rather than dropped",
        truncated.status === "sent" && deliveredText.length > 0 && deliveredText.length <= 4096,
        `source=${oversized.length} chars, delivered=${deliveredText.length} chars`,
    );

    check(
        "truncation cuts at a line boundary",
        !deliveredText.replace(/\n…$/, "").endsWith("line"),
        "dropping whole lines is what keeps a cut from landing inside a tag",
    );

    // ── A rejection is reported, not thrown ──────────────────────────────────
    stubFetch(false);
    const rejected = await sendTelegramMessage("hello");

    check(
        "a rejection returns Telegram's own description",
        rejected.status === "failed" && rejected.reason === "chat not found",
        `status=${rejected.status}, reason=${"reason" in rejected ? rejected.reason : "-"}`,
    );
} finally {
    globalThis.fetch = realFetch;

    await prisma.integrationCredential.deleteMany({ where: { provider: PROVIDER } });
    await prisma.integration.deleteMany({ where: { provider: PROVIDER } });

    if (priorRow) {
        await prisma.integration.create({
            data: {
                provider: priorRow.provider,
                enabled: priorRow.enabled,
                publicId: priorRow.publicId,
            },
        });
    }

    for (const credential of priorCredentials) {
        await prisma.integrationCredential.create({
            data: {
                provider: credential.provider,
                kind: credential.kind,
                value: credential.value,
                lastFour: credential.lastFour,
            },
        });
    }

    await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
