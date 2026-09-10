/**
 * Verifies that a courier's own explanation of a failure survives the trip to
 * the operator.
 *
 * THE STATUS CODE IS NOT THE DIAGNOSIS. A 401 from Steadfast means either
 * "your keys are wrong" or "your keys are fine and the account is dormant",
 * and only the response body tells the two apart. This distinction was found
 * the expensive way: an unactivated account answered `/create_order/bulk-order`
 * with the bare text `Account is not active!`, `JSON.parse` threw, the body was
 * discarded, and the panel reported `Courier request failed (401)`. That reads
 * like a credentials bug, so the credentials were the thing investigated —
 * while the actual message sat in a body nobody kept.
 *
 * So this asserts both halves of that lesson:
 *
 *  - a short plain-text error body reaches the caller intact;
 *  - a body that is NOT a message (empty, an HTML page, a wall of text) does
 *    not, because forwarding those is how a toast ends up rendering a stack
 *    trace and the generic fallback is the more honest thing to show.
 *
 * It also pins what must NOT change: a 2xx whose body cannot be read stays
 * `unconfirmed`, never `failed`. That one is load-bearing — Steadfast may have
 * created the consignments, and reporting it as failed invites the retry that
 * duplicates them.
 *
 * Pure — no database, no courier account. `fetch` is stubbed, so this passes
 * whether or not the Steadfast account is active. Run with:
 *   npx tsx scripts/verify-courier-error-message.ts
 */
import { envVars } from "../src/app/config/env";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/*
 * The client throws CourierNotConfiguredError before it ever calls fetch, and
 * this script must not depend on a configured account. Placeholders are set
 * only if the real ones are absent, and never printed.
 */
if (!envVars.STEADFAST_API_KEY) {
    (envVars as { STEADFAST_API_KEY?: string }).STEADFAST_API_KEY = "__verify_key";
}
if (!envVars.STEADFAST_SECRET_KEY) {
    (envVars as { STEADFAST_SECRET_KEY?: string }).STEADFAST_SECRET_KEY = "__verify_secret";
}

const realFetch = globalThis.fetch;

/** Answers the next request with exactly this status and body. */
const stubResponse = (status: number, body: string) => {
    globalThis.fetch = (async () =>
        new Response(body, { status })) as typeof globalThis.fetch;
};

const { SteadfastClient } = await import("../src/app/module/courier/steadfast.client");

/** One dispatch attempt against the stubbed response. */
const dispatchWith = async (status: number, body: string) => {
    stubResponse(status, body);
    return SteadfastClient.createBulkOrders([
        {
            invoice: "__verify_invoice",
            recipient_name: "Verify",
            recipient_phone: "01700000000",
            recipient_address: "Verify address, Dhaka",
            cod_amount: 0,
        },
    ]);
};

try {
    // The case that started this: the real body an unactivated account returns.
    const dormant = await dispatchWith(401, "Account is not active!");
    check(
        "plain-text 401 body is surfaced",
        dormant.outcome === "failed" && dormant.message.includes("Account is not active!"),
        dormant.outcome === "failed"
            ? `message: "${dormant.message}"`
            : `expected failed, got ${dormant.outcome}`,
    );
    check(
        "status is kept alongside the courier's words",
        dormant.outcome === "failed" && dormant.message.includes("401"),
        dormant.outcome === "failed" ? dormant.message : String(dormant.outcome),
    );

    // Retry safety must not shift just because the body became readable: we
    // reached Steadfast and it refused, so nothing was created.
    check(
        "a refused request stays retry-safe",
        dormant.outcome === "failed" && dormant.status === 401,
        dormant.outcome === "failed" ? `status ${dormant.status}` : String(dormant.outcome),
    );

    // JSON still wins where it exists — the documented envelope is unaffected.
    const json = await dispatchWith(422, JSON.stringify({ message: "Invalid phone number" }));
    check(
        "JSON error envelope still read as before",
        json.outcome === "failed" && json.message === "Invalid phone number",
        json.outcome === "failed" ? `message: "${json.message}"` : String(json.outcome),
    );

    // An HTML page is a body, not a message. Forwarding it would put markup in
    // a toast; the generic fallback says less but says it truthfully.
    const html = await dispatchWith(502, "<html><body><h1>502 Bad Gateway</h1></body></html>");
    check(
        "HTML error page falls back to the generic message",
        html.outcome === "failed" && html.message === "Courier request failed (502)",
        html.outcome === "failed" ? `message: "${html.message}"` : String(html.outcome),
    );

    const wall = await dispatchWith(500, "x".repeat(5000));
    check(
        "an oversized body falls back to the generic message",
        wall.outcome === "failed" && wall.message === "Courier request failed (500)",
        wall.outcome === "failed" ? `message: "${wall.message}"` : String(wall.outcome),
    );

    const empty = await dispatchWith(503, "");
    check(
        "an empty body falls back to the generic message",
        empty.outcome === "failed" && empty.message === "Courier request failed (503)",
        empty.outcome === "failed" ? `message: "${empty.message}"` : String(empty.outcome),
    );

    /*
     * The one that must never become `failed`. A 2xx we cannot parse means
     * Steadfast may have created the consignments and we cannot see what it
     * did; calling that a failure invites a duplicating retry.
     */
    const unreadableOk = await dispatchWith(200, "Account is not active!");
    check(
        "an unreadable 2xx stays unconfirmed, not failed",
        unreadableOk.outcome === "unconfirmed",
        `outcome: ${unreadableOk.outcome}`,
    );
} finally {
    globalThis.fetch = realFetch;
}

console.log(
    failures === 0
        ? "\nAll checks passed."
        : `\n${failures} check${failures === 1 ? "" : "s"} failed.`,
);

process.exit(failures === 0 ? 0 : 1);
