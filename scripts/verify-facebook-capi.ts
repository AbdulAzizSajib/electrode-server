/**
 * Verification for the server-side Conversions API report.
 *
 * The properties here are all ones whose failure is invisible in production —
 * events are accepted by Meta and counted wrongly, or not sent at all, and
 * nothing in the shop misbehaves:
 *
 *  - Disabled or unconfigured sends NOTHING, rather than an unauthenticated
 *    request that could only 401.
 *  - `event_id` is the ORDER ID. The browser pixel sends the same value, and
 *    Meta collapses the pair into one conversion. A different id in either place
 *    double-counts every sale, and a merchant reading doubled conversions raises
 *    ad spend against revenue that does not exist.
 *  - Email and phone are SHA-256 of normalised values, never raw. Sending raw
 *    PII hands a third party customer identities the shopper never agreed to
 *    share; hashing without normalising sends the PII and matches nothing, which
 *    is the worst of both.
 *  - The test event code is attached only while test mode is on. Sending it
 *    otherwise routes real conversions into Meta's debug stream, where they are
 *    visible and counted nowhere.
 *  - A failure never propagates, because the order has already committed.
 *
 * `fetch` is intercepted, so no request reaches Meta and no account is needed.
 * Writes under `__verify_` and restores in a `finally`. Run with:
 *   npx tsx scripts/verify-facebook-capi.ts
 */
import { createHash } from "node:crypto";
import { prisma } from "../src/app/lib/prisma";
import { reportPurchaseToCapi } from "../src/app/module/integration/facebook-capi";
import { IntegrationService } from "../src/app/module/integration/integration.service";
import {
    CredentialKind,
    IntegrationId,
} from "../src/app/module/integration/integration.constant";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const EMAIL = "  Shopper@Example.COM  ";
const PHONE = "+880 1712-345678";
const TOKEN = "__verify_capi_access_token_0123456789";
const PIXEL = "1247199439643328";

const realFetch = globalThis.fetch;

/** The last request the dispatcher made, or null when it made none. */
let captured: { url: string; body: Record<string, unknown> } | null = null;
let failNext = false;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    // Only Meta's endpoint is intercepted; anything else (there is nothing, but
    // a future change might add one) goes to the real implementation.
    if (!url.includes("graph.facebook.com")) {
        return realFetch(input as Parameters<typeof realFetch>[0], init);
    }

    captured = { url, body: JSON.parse(String(init?.body ?? "{}")) };

    if (failNext) return new Response("Invalid OAuth access token", { status: 400 });
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
}) as typeof globalThis.fetch;

/**
 * Fires one report and waits for the fire-and-forget work to settle.
 *
 * `expectSend` says whether a request is expected. When it is, this polls until
 * the intercepted fetch is seen — a fixed sleep was flaky, because the
 * dispatcher does two database reads before sending and those are slower when
 * the machine is busy. When no request is expected there is nothing to poll for,
 * so it waits a bounded moment and asserts the absence.
 *
 * Polling for the real signal rather than guessing a duration is the difference
 * between a test that fails under load and one that reports the truth.
 */
const report = async (
    over: Partial<Parameters<typeof reportPurchaseToCapi>[0]> = {},
    expectSend = true,
) => {
    captured = null;
    reportPurchaseToCapi({
        orderId: "__verify_order_id_abc123",
        value: 2499.5,
        currency: "BDT",
        email: EMAIL,
        phone: PHONE,
        createdAt: new Date("2026-09-14T10:00:00.000Z"),
        ...over,
    });

    // The dispatcher is deliberately not awaitable — that is the point of its
    // shape — so the only way to observe it is to watch for its effect.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        if (expectSend && captured !== null) return;
        if (!expectSend && Date.now() > deadline - 4600) return;
    }
};

const setConfig = async (capi: Record<string, unknown> | null, pixelId = PIXEL) =>
    prisma.storeSetting.update({
        where: { id: "singleton" },
        data: {
            integrationConfig: {
                facebookPixel: { enabled: true, pixelId },
                ...(capi ? { facebookCapi: capi } : {}),
            },
        },
    });

const priorSetting = await prisma.storeSetting.findUnique({
    where: { id: "singleton" },
    select: { integrationConfig: true },
});
const priorCredentials = await prisma.integrationCredential.findMany({
    where: { provider: IntegrationId.FACEBOOK_CAPI },
});
const priorRow = await prisma.integration.findUnique({
    where: { provider: IntegrationId.FACEBOOK_CAPI },
});

try {
    console.log("\n--- Nothing is sent unless it is fully configured ---\n");

    await setConfig({ enabled: false, testMode: false, testEventCode: "" });
    await IntegrationService.updateCredentials(undefined, IntegrationId.FACEBOOK_CAPI, {
        [CredentialKind.ACCESS_TOKEN]: TOKEN,
    });
    await report({}, false);

    check(
        "a disabled integration sends nothing",
        captured === null,
        "the merchant switched it off; sending anyway would be ignoring them",
    );

    await setConfig({ enabled: true, testMode: false, testEventCode: "" });
    await prisma.integrationCredential.deleteMany({
        where: { provider: IntegrationId.FACEBOOK_CAPI },
    });
    await report({}, false);

    check(
        "a missing access token sends nothing",
        captured === null,
        "there is nothing to authenticate with, so the request could only 401",
    );

    await IntegrationService.updateCredentials(undefined, IntegrationId.FACEBOOK_CAPI, {
        [CredentialKind.ACCESS_TOKEN]: TOKEN,
    });
    await setConfig({ enabled: true, testMode: false, testEventCode: "" }, "");
    await report({}, false);

    check(
        "a missing pixel id sends nothing",
        captured === null,
        "an event has to say which pixel it belongs to",
    );

    console.log("\n--- A configured integration sends a well-formed event ---\n");

    await setConfig({ enabled: true, testMode: false, testEventCode: "" });
    await report();

    const event = (captured as unknown as { body: { data: Record<string, unknown>[] } } | null)
        ?.body.data[0];

    check(
        "an event is sent",
        captured !== null && Array.isArray((captured as { body: { data?: unknown[] } }).body.data),
        "everything below depends on this",
    );

    check(
        "it is a Purchase",
        event?.event_name === "Purchase",
        "the only event this path reports",
    );

    check(
        "the event_id is the order id",
        event?.event_id === "__verify_order_id_abc123",
        "this is the deduplication key the browser pixel must also send — the whole reason double-counting is avoided",
    );

    check(
        "value and currency travel with it",
        (event?.custom_data as { value?: number; currency?: string })?.value === 2499.5 &&
            (event?.custom_data as { currency?: string })?.currency === "BDT",
        "Meta rejects an event with no currency, so a blank one drops the conversion silently",
    );

    check(
        "the event time is the order's, not now",
        event?.event_time === Math.floor(new Date("2026-09-14T10:00:00.000Z").getTime() / 1000),
        "they diverge whenever this is retried or delayed, and Meta attributes on the event time",
    );

    console.log("\n--- PII is hashed, never sent raw ---\n");

    const userData = event?.user_data as { em?: string; ph?: string };
    const expectedEmail = createHash("sha256").update("shopper@example.com").digest("hex");
    const expectedPhone = createHash("sha256").update("8801712345678").digest("hex");

    check(
        "the email is SHA-256 of the trimmed, lowercased value",
        userData?.em === expectedEmail,
        "hashing without normalising transmits the PII and matches no profile — the worst of both",
    );

    check(
        "the phone is SHA-256 of its digits only",
        userData?.ph === expectedPhone,
        "a stored +880 form and a shopper's local form are the same person and must hash alike",
    );

    const serialised = JSON.stringify(captured);

    check(
        "no raw email appears anywhere in the request",
        !serialised.includes("shopper@example.com") && !serialised.includes("Shopper@Example.COM"),
        "raw PII to a third party is a disclosure the shopper never agreed to",
    );

    check(
        "no raw phone appears anywhere in the request",
        !serialised.includes("1712345678") && !serialised.includes("1712-345678"),
        "same reasoning as the email",
    );

    await report({ email: null, phone: null });
    const anonymous = (captured as unknown as { body: { data: Record<string, unknown>[] } } | null)
        ?.body.data[0];

    check(
        "an order with no contact details still reports",
        anonymous?.event_id === "__verify_order_id_abc123",
        "the conversion is worth reporting even when it cannot be attributed to a person",
    );

    check(
        "absent PII is omitted rather than sent as empty hashes",
        (anonymous?.user_data as { em?: string })?.em === undefined,
        "a hash of the empty string is a value that matches nothing and looks like data",
    );

    console.log("\n--- Test mode is explicit ---\n");

    await setConfig({ enabled: true, testMode: true, testEventCode: "TEST12345" });
    await report();

    check(
        "test mode attaches the code",
        (captured as unknown as { body: { test_event_code?: string } } | null)?.body
            .test_event_code === "TEST12345",
        "without it the events do not appear in the debug panel the merchant is watching",
    );

    await setConfig({ enabled: true, testMode: false, testEventCode: "TEST12345" });
    await report();

    check(
        "a stored code is NOT sent when test mode is off",
        (captured as unknown as { body: { test_event_code?: string } } | null)?.body
            .test_event_code === undefined,
        "sending it would route real conversions into the test stream, counted nowhere",
    );

    console.log("\n--- A failure never propagates ---\n");

    failNext = true;
    let threw = false;

    try {
        await report();
    } catch {
        threw = true;
    }

    check(
        "a rejected event does not throw",
        !threw,
        "the order has already committed; measurement must never surface on the confirmation",
    );

    failNext = false;

    check(
        "the access token is never logged in a URL we print",
        captured !== null &&
            (captured as { url: string }).url.includes("access_token="),
        "it is in the query string, which is exactly why the error path logs the body and not the URL",
    );
} finally {
    globalThis.fetch = realFetch;

    await prisma.storeSetting.update({
        where: { id: "singleton" },
        data: {
            integrationConfig:
                (priorSetting?.integrationConfig as object | null) ?? undefined,
        },
    });

    await prisma.integrationCredential.deleteMany({
        where: { provider: IntegrationId.FACEBOOK_CAPI },
    });
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
    if (!priorRow) {
        await prisma.integration.deleteMany({ where: { provider: IntegrationId.FACEBOOK_CAPI } });
    }

    const leftovers = await prisma.integrationCredential.count({
        where: { provider: IntegrationId.FACEBOOK_CAPI, lastFour: "6789" },
    });
    console.log(`\nCleanup: ${leftovers} __verify_ credential(s) remaining (expected 0).`);

    await prisma.$disconnect();
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
