/**
 * Verification for courier dispatch: eligibility and result matching.
 *
 * Deliberately does NOT call Steadfast. Every property checked here is one whose
 * failure costs a parcel or a duplicate consignment, and none of them needs a
 * real courier to demonstrate:
 *
 *  - an unpacked order is never sent,
 *  - an already-dispatched order never gets a second consignment,
 *  - an oversized selection is refused rather than truncated,
 *  - a mixed selection yields a verdict per order, and
 *  - results are matched by invoice, not by position in the response.
 *
 * The last is the one that most needs a test: it is correct today and would stay
 * "correct-looking" if someone rewrote it positionally, right up until Steadfast
 * returned a reordered array.
 *
 * Since add-courier-provider-selection these run against the STEADFAST provider
 * explicitly rather than an implicit single courier. The assertions are
 * unchanged: they are properties of dispatching to a courier, not of dispatching
 * to Steadfast, and every provider must uphold them.
 *
 * Run with: npx tsx scripts/verify-courier-dispatch.ts
 */
import { ICourierOrderForDispatch } from "../src/app/module/courier/courier.interface";
import { ICourierConsignmentResult } from "../src/app/module/courier/courier.provider";
import { CourierService, matchResultsByInvoice } from "../src/app/module/courier/courier.service";
import { SteadfastProvider } from "../src/app/module/courier/providers/steadfast.provider";

const { evaluateOrder } = CourierService._internals;

/** Eligibility is provider-aware now; these checks exercise Steadfast's rules. */
const evaluate = (order: ICourierOrderForDispatch) => evaluateOrder(order, SteadfastProvider);

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

const order = (over: Partial<ICourierOrderForDispatch> = {}): ICourierOrderForDispatch => ({
    id: "order_1",
    orderNumber: "ORD-1001",
    status: "PACKED",
    notes: null,
    totalAmount: 3500,
    customer: { firstName: "Rahim", lastName: "Uddin", phone: "+8801712345678" },
    shippingAddress: {
        fullName: "Rahim Uddin",
        phone: "+8801712345678",
        addressLine1: "House 44, Road 2/A",
        addressLine2: null,
        city: "Dhaka",
        state: null,
        postalCode: "1209",
    },
    payments: [],
    shipments: [],
    ...over,
});

console.log("\n--- Eligibility ---\n");

check(
    "a packed order is eligible",
    evaluate(order()).eligible,
    "the normal path",
);

for (const status of ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "COMPLETED"]) {
    const verdict = evaluate(order({ status }));
    check(
        `a ${status} order is ineligible`,
        !verdict.eligible && verdict.reason === "NOT_PACKED",
        verdict.detail ?? "",
    );
}

const dispatched = evaluate(
    order({ shipments: [{ id: "ship_1", consignmentId: "1424107" }] }),
);

check(
    "an already-dispatched order is refused a second consignment",
    !dispatched.eligible && dispatched.reason === "ALREADY_DISPATCHED",
    "a duplicate consignment is a second pickup for a parcel that does not exist, billed to the merchant",
);

check(
    "the refusal carries the existing consignment id",
    dispatched.consignmentId === "1424107",
    "so the panel can show what exists rather than only refusing",
);

// Ordering matters: a dispatched order that is also not PACKED (it will be
// SHIPPED) must report ALREADY_DISPATCHED, which is the more useful truth.
const dispatchedAndShipped = evaluate(
    order({ status: "SHIPPED", shipments: [{ id: "ship_1", consignmentId: "1424107" }] }),
);

check(
    "already-dispatched outranks not-packed",
    dispatchedAndShipped.reason === "ALREADY_DISPATCHED",
    "'not packed' would be true but useless for an order already with the courier",
);

check(
    "a manual shipment with no consignment does not block dispatch",
    evaluate(order({ shipments: [{ id: "ship_1", consignmentId: null }] })).eligible,
    "such an order is updated in place, not refused",
);

console.log("\n--- Selection bounds ---\n");

const tooMany = Array.from({ length: 201 }, (_, i) => `order_${i}`);

await CourierService.previewDispatch(tooMany)
    .then(() => check("a selection over 200 is refused", false, "it was accepted"))
    .catch((error: Error) =>
        check(
            "a selection over 200 is refused",
            /200/.test(error.message) && /split/i.test(error.message),
            "and the message tells the operator to split it",
        ),
    );

await CourierService.previewDispatch([])
    .then(() => check("an empty selection is refused", false, "it was accepted"))
    .catch(() => check("an empty selection is refused", true, ""));

console.log("\n--- Results are matched by invoice, never by position ---\n");

const sent = ["ORD-1001", "ORD-1002", "ORD-1003"];

/** Deliberately reordered, and with one rejection in the middle. */
const reordered: ICourierConsignmentResult[] = [
    { invoice: "ORD-1003", consignmentId: "3003", trackingCode: "CCC", accepted: true },
    { invoice: "ORD-1001", consignmentId: "1001", trackingCode: "AAA", accepted: true },
    { invoice: "ORD-1002", consignmentId: null, trackingCode: null, accepted: false },
];

const matched = matchResultsByInvoice(sent, reordered);

check(
    "a reordered response still pairs each invoice with its own consignment",
    matched.accepted.find((a) => a.invoice === "ORD-1001")?.consignmentId === "1001" &&
        matched.accepted.find((a) => a.invoice === "ORD-1003")?.consignmentId === "3003",
    "positional matching would have given ORD-1001 the id 3003 — a wrong tracking number to a real customer",
);

check(
    "a rejected row is reported as failed, not accepted",
    matched.rejected.length === 1 && matched.rejected[0]?.invoice === "ORD-1002",
    "",
);

check(
    "a rejected row yields no consignment",
    !matched.accepted.some((a) => a.invoice === "ORD-1002"),
    "",
);

const partial = matchResultsByInvoice(sent, [
    { invoice: "ORD-1001", consignmentId: "1001", trackingCode: "AAA", accepted: true },
]);

check(
    "an invoice absent from the response is unconfirmed, not failed",
    partial.missing.length === 2 && partial.missing.includes("ORD-1002"),
    "we cannot say the courier did not create it, so it must not be offered a retry",
);

const stray = matchResultsByInvoice(sent, [
    { invoice: "ORD-9999", consignmentId: "9999", trackingCode: "ZZZ", accepted: true },
]);

check(
    "an invoice we never sent is isolated, not applied",
    stray.unknownInvoices.length === 1 && stray.accepted.length === 0,
    "applying it would write a consignment onto an order that was never dispatched",
);

check(
    "a success row with no consignment id is not treated as accepted",
    matchResultsByInvoice(["ORD-1"], [
        { invoice: "ORD-1", consignmentId: null, trackingCode: null, accepted: true },
    ]).rejected.length === 1,
    "there is nothing to record, so calling it dispatched would lose the parcel",
);

console.log("\n--- Courier status derivation (Steadfast's vocabulary) ---\n");

/*
 * Status interpretation moved onto the provider: the vocabulary is the
 * courier's, so only that courier's adapter can say what one of its strings
 * means. The properties asserted are exactly the ones asserted before.
 */
const readStatus = (raw: string) => SteadfastProvider.readStatus!(raw);

check(
    "a status is read case-insensitively",
    readStatus("Delivered").rawStatus === "delivered",
    "the courier's casing is not consistent between its docs and its payloads",
);

check(
    "delivered is terminal",
    readStatus("delivered").isTerminal && readStatus("Delivered").isTerminal,
    "and case-insensitively so",
);

check(
    "an approval-pending state is NOT terminal",
    !readStatus("delivered_approval_pending").isTerminal,
    "the merchant has not been paid yet, so it must keep being reconciled",
);

check(
    "only an exact delivered advances the order",
    readStatus("delivered").isFullyDelivered &&
        !readStatus("partial_delivered").isFullyDelivered,
    "closing an order while goods are still coming back is unrecoverable — DELIVERED has no transition out",
);

check(
    "cancelled needs attention",
    readStatus("cancelled").needsAttention,
    "the parcel is coming back and only a human can resolve it",
);

check(
    "partial_delivered needs attention",
    readStatus("partial_delivered").needsAttention,
    "no automatic rule can decide what was collected and what is returning",
);

check(
    "delivered does not need attention",
    !readStatus("delivered").needsAttention,
    "",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
