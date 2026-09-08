/**
 * Verification for the order → consignment mapping.
 *
 * Covers the conversions where a silent wrong answer costs a parcel: the phone
 * format Steadfast will reject, the address length it will accept and then
 * misdeliver, and the COD figure a rider actually collects.
 *
 * Pure functions only — no database, no network, no Steadfast. Run with:
 *   npx tsx scripts/verify-courier-mapping.ts
 */
import {
    MAX_ADDRESS_LENGTH,
    composeAddress,
    computeCodAmount,
    mapOrderToConsignment,
} from "../src/app/module/courier/courier.mapper";
import { ICourierOrderForDispatch } from "../src/app/module/courier/courier.interface";
import { toLocalPhone } from "../src/app/utils/phone";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** A dispatchable order with everything valid; tests override one thing each. */
const baseOrder = (over: Partial<ICourierOrderForDispatch> = {}): ICourierOrderForDispatch => ({
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

console.log("\n--- Phone conversion (stored E.164 → courier's 11 local digits) ---\n");

check(
    "E.164 converts to local form",
    toLocalPhone("+8801712345678") === "01712345678",
    "Steadfast rejects the stored +880 form outright, so this is mandatory, not cosmetic",
);

check(
    "an already-local number is idempotent",
    toLocalPhone("01712345678") === "01712345678",
    "operators paste numbers in both forms",
);

check(
    "a separator-laden number still converts",
    toLocalPhone("+880 1712-345678") === "01712345678",
    "normalizePhone strips separators before this runs",
);

check(
    "a non-BD number is refused, not mangled",
    toLocalPhone("+14155551234") === null,
    "returning null is what makes pre-flight report it instead of sending it",
);

check(
    "the result is exactly 11 digits",
    (toLocalPhone("+8801912345678") ?? "").length === 11,
    "Steadfast validates the length exactly",
);

console.log("\n--- Address composition ---\n");

check(
    "empty parts are dropped",
    composeAddress({
        addressLine1: "House 44",
        addressLine2: null,
        city: "Dhaka",
        state: null,
        postalCode: null,
    }) === "House 44, Dhaka",
    "otherwise the courier reads ', ,' gaps as part of the address",
);

check(
    "country is never included",
    !composeAddress({
        addressLine1: "House 44",
        addressLine2: "Flat B2",
        city: "Dhaka",
        state: "Inside Dhaka",
        postalCode: "1209",
    }).includes("Bangladesh"),
    "Steadfast is domestic-only; it would spend characters against a hard limit",
);

check(
    "a landing-page order's delivery zone in `state` is carried",
    composeAddress({
        addressLine1: "House 44",
        addressLine2: null,
        city: "Dhaka",
        state: "Inside Dhaka",
        postalCode: null,
    }) === "House 44, Dhaka, Inside Dhaka",
    "that column is where a landing-page order records its zone",
);

console.log("\n--- Address length: refused, never truncated ---\n");

// Exactly at the limit: this must pass, or the boundary is off by one and real
// orders are refused for fitting.
const atLimit = "A".repeat(MAX_ADDRESS_LENGTH - "Dhaka".length - 2);
const atLimitResult = mapOrderToConsignment(
    baseOrder({
        shippingAddress: {
            fullName: "Rahim Uddin",
            phone: "+8801712345678",
            addressLine1: atLimit,
            addressLine2: null,
            city: "Dhaka",
            state: null,
            postalCode: null,
        },
    }),
);

check(
    `an address of exactly ${MAX_ADDRESS_LENGTH} characters is accepted`,
    atLimitResult.ok && atLimitResult.payload.recipient_address.length === MAX_ADDRESS_LENGTH,
    `got ${atLimitResult.ok ? atLimitResult.payload.recipient_address.length : "a refusal"}`,
);

const overLimit = mapOrderToConsignment(
    baseOrder({
        shippingAddress: {
            fullName: "Rahim Uddin",
            phone: "+8801712345678",
            addressLine1: "A".repeat(300),
            addressLine2: null,
            city: "Dhaka",
            state: null,
            postalCode: null,
        },
    }),
);

check(
    "an over-length address is refused",
    !overLimit.ok && overLimit.reason === "ADDRESS_TOO_LONG",
    "a truncated address passes the courier's validation and delivers nowhere",
);

check(
    "the refusal names the actual length",
    !overLimit.ok && /\d{3}/.test(overLimit.detail),
    "the operator has to know how much to cut",
);

console.log("\n--- COD amount ---\n");

check(
    "an unpaid COD order collects the full total",
    computeCodAmount({ totalAmount: 3500, payments: [] }) === 3500,
    "the normal path for this shop",
);

check(
    "a fully prepaid order collects nothing",
    computeCodAmount({
        totalAmount: 3500,
        payments: [{ amount: 3500, status: "PAID" }],
    }) === 0,
    "Steadfast accepts 0 and simply delivers",
);

check(
    "a partly paid order collects the remainder",
    computeCodAmount({
        totalAmount: 3500,
        payments: [{ amount: 1000, status: "PAID" }],
    }) === 2500,
    "",
);

check(
    "an unpaid payment row does not reduce the amount",
    computeCodAmount({
        totalAmount: 3500,
        payments: [{ amount: 3500, status: "PENDING" }],
    }) === 3500,
    "only PAID counts — a pending row is not money collected",
);

check(
    "an over-payment cannot produce a negative amount",
    computeCodAmount({
        totalAmount: 1000,
        payments: [{ amount: 1500, status: "PAID" }],
    }) === 0,
    "Steadfast rejects a negative cod_amount for the whole batch",
);

check(
    "a float artefact is rounded away",
    computeCodAmount({
        totalAmount: 1060.1,
        payments: [{ amount: 0.1, status: "PAID" }],
    }) === 1060,
    "1059.9999999 is not a figure to hand a delivery rider",
);

console.log("\n--- Full mapping ---\n");

const mapped = mapOrderToConsignment(baseOrder());

check(
    "invoice is the order number",
    mapped.ok && mapped.payload.invoice === "ORD-1001",
    "it is already unique, already immutable, and already what the label's barcode encodes",
);

check(
    "recipient name prefers the shipping address",
    mapped.ok && mapped.payload.recipient_name === "Rahim Uddin",
    "",
);

const noAddressName = mapOrderToConsignment(
    baseOrder({
        shippingAddress: {
            fullName: "",
            phone: "+8801712345678",
            addressLine1: "House 44",
            addressLine2: null,
            city: "Dhaka",
            state: null,
            postalCode: null,
        },
    }),
);

check(
    "recipient name falls back to the customer",
    noAddressName.ok && noAddressName.payload.recipient_name === "Rahim Uddin",
    "a guest order may carry no name on the address",
);

const noAddress = mapOrderToConsignment(baseOrder({ shippingAddress: null }));

check(
    "an order with no shipping address is refused",
    !noAddress.ok && noAddress.reason === "NO_SHIPPING_ADDRESS",
    "",
);

const badPhone = mapOrderToConsignment(
    baseOrder({
        customer: { firstName: "Rahim", lastName: null, phone: null },
        shippingAddress: {
            fullName: "Rahim Uddin",
            phone: "12345",
            addressLine1: "House 44",
            addressLine2: null,
            city: "Dhaka",
            state: null,
            postalCode: null,
        },
    }),
);

check(
    "an unusable phone is refused with the offending value",
    !badPhone.ok && badPhone.reason === "INVALID_PHONE" && badPhone.detail.includes("12345"),
    "the operator has to know which number to fix",
);

check(
    "no delivery_type is ever sent",
    mapped.ok && !("delivery_type" in mapped.payload),
    "the bulk endpoint accepts none; every consignment is the courier's default home delivery",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
