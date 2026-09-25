/**
 * Pins the two things about advance-payment SETTINGS that break silently.
 *
 * 1. THE THREE HAND-SYNCED COPIES AGREE. The shape lives in the backend's Zod
 *    schema, in `frontend/src/types/store-settings.ts`, and in
 *    `admin/src/lib/api/store-settings.ts`. The packages never import each
 *    other, so a field renamed in one place produces no type error anywhere —
 *    the admin simply saves a key the backend strips, and the merchant's change
 *    vanishes with a success toast. Same obligation `verify-revalidate-tags.ts`
 *    discharges for cache tags, and the same failure mode.
 *
 *    Checked by reading the two frontend files as TEXT. They cannot be imported
 *    from here (different tsconfig, different module resolution), and a shallow
 *    text check that catches a rename is worth more than a perfect check that
 *    does not run.
 *
 * 2. THE FEATURE-OFF PATH IS UNCHANGED. A store that has never configured
 *    advance payment must read as disabled and keep every other setting it had.
 *    The read collapsing to DEFAULT_CHECKOUT_CONFIG instead would discard the
 *    merchant's own fields, notice and delivery options — silently, and only
 *    for stores that predate the feature, which is the population least likely
 *    to be testing it.
 *
 * Reads only; creates nothing and needs no cleanup.
 *
 * Run with:
 *   npx tsx scripts/verify-advance-payment-settings.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ADVANCE_PAYMENT } from "../src/app/module/store-setting/store-setting.constant";
import { StoreSettingService } from "../src/app/module/store-setting/store-setting.service";
import { checkoutConfigSchema } from "../src/app/module/store-setting/store-setting.validation";

let failures = 0;

const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!ok) failures += 1;
};

/** Repo root, from server/scripts. */
const ROOT = join(import.meta.dirname, "..", "..");

const readOrNull = (relativePath: string): string | null => {
    try {
        return readFileSync(join(ROOT, relativePath), "utf-8");
    } catch {
        return null;
    }
};

/* ------------------------------------------------------------------ *
 * 1. The field names, as the backend defines them.
 * ------------------------------------------------------------------ */

/*
 * Derived from the schema rather than written out again here. A list typed by
 * hand is a fourth copy to keep in step, which is the very problem this script
 * exists to catch.
 */
const sample = {
    enabled: true,
    mobileAccounts: [
        { id: "bkash-main", provider: "BKASH", number: "01931105403", accountType: "Personal" },
    ],
    bankAccounts: [
        {
            id: "brac-main",
            bankName: "BRAC Bank PLC",
            accountName: "DEKHBO KINBO DOT COM",
            accountNumber: "2052740280001",
            branch: "Benapole SME/Krishi Br",
            routingNumber: "060410298",
        },
    ],
};

const parsed = checkoutConfigSchema.safeParse({
    fields: {
        fullName: { show: true, required: true },
        phone: { show: true, required: true },
        addressLine1: { show: true, required: true },
        addressLine2: { show: true, required: false },
        city: { show: true, required: true },
        postalCode: { show: true, required: false },
    },
    showCouponBox: true,
    showOrderNote: true,
    allowGuestCheckout: true,
    notice: "",
    delivery: { offersPickup: false, options: [] },
    advancePayment: sample,
});

check(
    "the sample parses against the backend schema",
    parsed.success,
    parsed.success ? "schema accepts it" : JSON.stringify(parsed.error?.issues?.[0]),
);

const BLOCK_KEYS = Object.keys(sample);
const MOBILE_KEYS = Object.keys(sample.mobileAccounts[0]);
const BANK_KEYS = Object.keys(sample.bankAccounts[0]);
const ALL_KEYS = [...new Set([...BLOCK_KEYS, ...MOBILE_KEYS, ...BANK_KEYS])];

/* ------------------------------------------------------------------ *
 * 2. Both frontend mirrors carry every one of them.
 * ------------------------------------------------------------------ */

const mirrors: [string, string][] = [
    ["storefront", "frontend/src/types/store-settings.ts"],
    ["admin", "admin/src/lib/api/store-settings.ts"],
];

for (const [name, path] of mirrors) {
    const source = readOrNull(path);

    if (source === null) {
        check(`${name}: mirror file is readable`, false, `could not read ${path}`);
        continue;
    }

    const missing = ALL_KEYS.filter((key) => !source.includes(key));
    check(
        `${name}: every backend field name appears in its mirror`,
        missing.length === 0,
        missing.length === 0
            ? `all ${ALL_KEYS.length} field names present in ${path}`
            : `MISSING from ${path}: ${missing.join(", ")} — rename it there too, or the merchant's save is silently stripped`,
    );

    check(
        `${name}: the block itself is declared`,
        source.includes("advancePayment"),
        `advancePayment ${source.includes("advancePayment") ? "present" : "ABSENT"} in ${path}`,
    );
}

/* ------------------------------------------------------------------ *
 * 3. The feature-off path is unchanged.
 * ------------------------------------------------------------------ */

check(
    "the default is OFF",
    DEFAULT_ADVANCE_PAYMENT.enabled === false,
    "a store upgraded into this feature keeps taking plain cash-on-delivery orders",
);
check(
    "the default has no accounts",
    DEFAULT_ADVANCE_PAYMENT.mobileAccounts.length === 0 &&
        DEFAULT_ADVANCE_PAYMENT.bankAccounts.length === 0,
    "there is no bKash number that is right for someone else's shop",
);

/*
 * A row exactly as a store configured BEFORE this feature has it: no
 * `advancePayment` key, and real settings the merchant chose.
 */
const legacyRow = {
    fields: {
        fullName: { show: true, required: true },
        phone: { show: true, required: true },
        addressLine1: { show: true, required: true },
        addressLine2: { show: false, required: false },
        city: { show: true, required: true },
        postalCode: { show: true, required: false },
    },
    showCouponBox: false,
    showOrderNote: false,
    allowGuestCheckout: true,
    notice: "Merchant's own notice",
    delivery: {
        offersPickup: true,
        options: [
            { key: "inside-dhaka", label: "Inside Dhaka", kind: "DELIVERY", price: 70, days: 2 },
            { key: "shop-pickup", label: "Shop Pickup", kind: "PICKUP", price: 0, days: 0 },
        ],
    },
};

const read = StoreSettingService.checkoutConfigOf(legacyRow as never);

check(
    "a row with no advancePayment key reads as disabled",
    read.advancePayment.enabled === false,
    "absent and explicitly-off mean the same thing",
);
check(
    "...and the merchant's OWN settings survive",
    read.delivery.options.length === 2 &&
        read.notice === "Merchant's own notice" &&
        read.showCouponBox === false &&
        read.fields.addressLine2.show === false,
    "delivery options, notice, coupon box and field visibility all intact — NOT collapsed to the defaults",
);

const nullRead = StoreSettingService.checkoutConfigOf(null);
check(
    "a store that has configured nothing reads as disabled",
    nullRead.advancePayment.enabled === false,
    "no accounts, no demand for money up front",
);

const malformed = StoreSettingService.checkoutConfigOf({ fields: "nonsense" } as never);
check(
    "a malformed row degrades to defaults rather than throwing",
    malformed.advancePayment.enabled === false,
    "a settings problem must not become a checkout that demands money",
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
